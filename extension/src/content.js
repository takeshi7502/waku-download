(() => {
  "use strict";
  const CONTENT_VERSION = "1.4.6";
  const isFacebook = WakuFacebook.isFacebook(location.href);
  const isPixiv = location.hostname === "www.pixiv.net";
  const platform = isPixiv ? "pixiv" : isFacebook ? "facebook" : "x";
  const normalize = isPixiv ? WakuPixiv.normalize : isFacebook ? WakuFacebook.normalize : WakuX.normalize;
  const seenFacebookScripts = new WeakSet();
  const collections = new Map();
  const pixivPageData = new Map();
  let extensionBase;
  try { extensionBase = chrome.runtime.getURL(""); } catch { return; }
  const extensionOrigin = new URL(extensionBase).origin;
  const lifecycle = new AbortController();
  let disposed = false;
  let observer, watchTimer;
  let active = null;
  let host, frame, launcher;
  let enabled = false;
  let collapsed = true;
  let panelInteracted = false;
  let positionRevision = 0;
  let launcherPosition = { side: "right", top: 16 };
  let panelReady = false;
  let scanTimer, publishTimer;
  let lastPath = "";
  let pixivArtwork = null;
  let pixivLookup = null;
  let pixivLookupError = 0;
  let pixivLookupFailed = null;
  let facebookVideoContext = null;
  let lastFacebookVideo = null;
  let facebookLookup = null;
  let facebookReplayBytes = 0;
  const facebookReplay = [];
  function deactivate() {
    if (disposed) return;
    disposed = true;
    lifecycle.abort();
    observer?.disconnect();
    clearInterval(watchTimer);
    clearTimeout(scanTimer);
    clearTimeout(publishTimer);
    if (facebookLookup) { clearTimeout(facebookLookup.timer); facebookLookup.controller.abort(); }
    for (const collection of collections.values()) clearTimeout(collection.saveTimer);
    panelReady = false;
    // The old iframe cannot reconnect after Chrome reloads the extension.
    // Leave a plain page button that works without calling extension APIs.
    if (host && launcher) {
      host.classList.add("collapsed");
      frame?.remove();
      launcher.hidden = false;
      launcher.textContent = "↻";
      launcher.title = "Tiện ích đã cập nhật — bấm để tải lại trang";
      launcher.setAttribute("aria-label", launcher.title);
      launcher.addEventListener("click", () => location.reload(), { once: true });
    }
  }
  function contextReady() {
    if (disposed) return false;
    try { if (chrome.runtime?.id) return true; } catch {}
    deactivate();
    return false;
  }
  // sendMessage can throw before returning a Promise; catch that at an async boundary.
  async function send(message) {
    if (!contextReady()) return null;
    try { return await chrome.runtime.sendMessage(message); }
    catch (error) {
      if (/extension context invalidated/i.test(error?.message || "") || !contextReady()) {
        deactivate();
        return null;
      }
      throw error;
    }
  }
  function registerChromeListener(event, listener) {
    if (!contextReady()) return false;
    try { event().addListener(listener); return true; }
    catch { deactivate(); return false; }
  }

  function currentHandle() {
    if (isPixiv) {
      const id = WakuPixiv.artwork(location.href);
      return WakuPixiv.profile(location.href) || (id && pixivArtwork?.id === id ? pixivArtwork.owner : null);
    }
    if (isFacebook) {
      const direct = WakuFacebook.profile(location.href);
      const video = WakuFacebook.videoId(location.href);
      return direct || (video && facebookVideoContext?.id === video ? facebookVideoContext.handle : null);
    }
    const direct = WakuX.profile(location.href);
    if (direct) return direct;
    const match = location.pathname.match(/^\/([\w]{1,15})\/(?:status\/\d+|with_replies|highlights|articles)(?:\/|$)/);
    return match ? WakuX.profile(match[1]) : null;
  }
  function savedState(collection) {
    return { platform, handle: collection.handle, profileId: collection.profileId, items: [...collection.images.values()], selected: [...collection.selected], selectNew: collection.selectNew, scrollTop: collection.scrollTop, name: collection.name, avatar: collection.avatar };
  }
  function persist(collection) {
    if (!contextReady() || !collection || collection.restoring) return;
    clearTimeout(collection.saveTimer);
    collection.saveTimer = setTimeout(() => {
      void send({ type: "SAVE_SCAN", state: savedState(collection) }).catch(() => {});
    }, 300);
  }
  function publish() {
    if (!contextReady()) return;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      if (!contextReady() || !panelReady || !frame) return;
      frame.contentWindow.postMessage({ type: "WAKU_PANEL_STATE", state: snapshot() }, extensionOrigin);
    }, 40);
  }
  function snapshot() {
    const artworkId = isPixiv && WakuPixiv.artwork(location.href);
    const state = active && (!artworkId || currentHandle()) ? savedState(active) : { handle: null, items: [], selected: [], selectNew: true, scrollTop: 0 };
    if (artworkId) {
      state.items = state.items.filter(item => item.tweetId === artworkId);
      const ids = new Set(state.items.map(item => item.id));
      state.selected = state.selected.filter(id => ids.has(id));
    }
    if (!artworkId) {
      const url = new URL(location.href);
      const filter = url.searchParams.get("filter")?.toLowerCase();
      const facebookVideo = isFacebook && WakuFacebook.videoId(location.href);
      const videoPage = isFacebook && (facebookVideo || /[\/](?:videos|reels)(?:\/|$)/i.test(url.pathname) || ["videos", "reels"].includes(url.searchParams.get("sk")?.toLowerCase()));
      const pageKind = videoPage || (!isFacebook && !isPixiv && ["video", "videos"].includes(filter)) ? "video" : !isFacebook && !isPixiv && ["photo", "photos"].includes(filter) ? "photo" : null;
      if (pageKind) {
        state.items = state.items.filter(item => (item.kind === "video" ? "video" : "photo") === pageKind && (!facebookVideo || item.id === facebookVideo));
        const ids = new Set(state.items.map(item => item.id));
        state.selected = state.selected.filter(id => ids.has(id));
      }
    }
    const facebookVideo = isFacebook && WakuFacebook.videoId(location.href);
    return { platform, ...state, restoring: active?.restoring || false, onProfile: !!currentHandle(), onPhotos: !isFacebook || WakuFacebook.isPhotos(location.href) || !!facebookVideo, facebookVideoPage: !!facebookVideo, facebookSearching: !!facebookVideo && facebookLookup?.id === facebookVideo && ["queued", "loading"].includes(facebookLookup.status), pixivErrors: pixivLookupError || active?.pixivErrors || 0, pixivRestricted: !!active?.pixivRestricted, limit: WakuX.LIMIT };
  }
  function syncProfile() {
    const handle = currentHandle();
    if (!handle || active?.handle.toLowerCase() === handle.toLowerCase()) return;
    persist(active);
    const key = handle.toLowerCase();
    if (collections.has(key)) { active = collections.get(key); if (isPixiv) pumpPixiv(active); publish(); return; }
    const collection = { handle, profileId: (isFacebook || isPixiv) && /^\d{1,25}$/.test(handle) ? handle : null, images: new Map(), candidates: new Map(), pixivPending: new Map(), xVideoPending: new Map(), selected: new Set(), selectNew: true, scrollTop: 0, name: handle, avatar: null, restoring: true, selectionRevision: 0 };
    collections.set(key, collection);
    active = collection;
    publish();
    void send({ type: "LOAD_SCAN", handle }).then(result => {
      const saved = result?.state;
      if (saved) {
        const freshIds = new Set(collection.images.keys());
        const restoredIds = new Set();
        for (const raw of saved.items || []) {
          const item = normalize(raw, handle);
          if (!item) continue;
          restoredIds.add(item.id);
          if (!collection.images.has(item.id) && collection.images.size < WakuX.LIMIT) collection.images.set(item.id, item);
        }
        if (!collection.selectionRevision) {
          collection.selectNew = saved.selectNew !== false;
          collection.selected = new Set((saved.selected || []).filter(id => collection.images.has(id)));
          if (collection.selectNew) for (const id of freshIds) if (!restoredIds.has(id)) collection.selected.add(id);
          collection.scrollTop = saved.scrollTop || 0;
        }
        if (collection.name === handle) collection.name = saved.name || handle;
        if (!collection.profileId && /^\d{1,25}$/.test(saved.profileId || "")) collection.profileId = saved.profileId;
        collection.avatar ||= saved.avatar || null;
      }
    }).catch(() => {}).finally(() => {
      collection.restoring = false;
      persist(collection);
      if (active === collection) publish();
    });
    if (isFacebook) window.postMessage({ type: "WAKU_READ_CACHE" }, location.origin);
  }
  function ingest(items) {
    syncProfile();
    if (!active || !currentHandle() || !Array.isArray(items)) return;
    let changed = false;
    for (const raw of items.slice(0, WakuX.LIMIT)) {
      let item = normalize(raw, active.handle);
      if (!item) continue;
      if (isFacebook && item.source === "dom") {
        const candidate = active.candidates.get(item.id);
        if (candidate && (candidate.width * candidate.height >= item.width * item.height || !candidate.width)) item = candidate;
      }
      const previous = active.images.get(item.id);
      if (!previous) {
        if (active.images.size >= WakuX.LIMIT) break;
        active.images.set(item.id, item);
        if (active.selectNew) active.selected.add(item.id);
        changed = true;
      } else if (isFacebook && item.source === "api" && (previous.source !== "api" || item.width * item.height > previous.width * previous.height || (item.width * item.height === previous.width * previous.height && item.url !== previous.url))) {
        active.images.set(item.id, item);
        changed = true;
      } else if (!isFacebook && !isPixiv && item.source === "api" && (previous.source !== "api" || previous.text !== item.text || previous.date !== item.date)) {
        active.images.set(item.id, item);
        changed = true;
      }
    }
    if (changed) { persist(active); publish(); }
  }
  function rememberFacebook(data) {
    const ids = WakuFacebook.videoIds(data);
    if (!ids.length) return;
    let bytes;
    try { bytes = JSON.stringify(data).length * 2; } catch { return; }
    if (bytes > 2000000) return;
    facebookReplay.push({ data, ids, bytes });
    facebookReplayBytes += bytes;
    while (facebookReplay.length > 30 || facebookReplayBytes > 10000000) facebookReplayBytes -= facebookReplay.shift().bytes;
  }
  function cacheFacebook(data, replay = false) {
    if (!replay) rememberFacebook(data);
    const video = WakuFacebook.videoId(location.href);
    if (video) {
      const owner = WakuFacebook.videoOwner(data, video);
      if (owner) { facebookVideoContext = { id: video, ...owner }; syncProfile(); if (active && owner.name) { active.name = owner.name; persist(active); } }
    }
    if (!active || (!video && !WakuFacebook.isPhotos(location.href))) return;
    const candidates = WakuFacebook.extract(data, active.handle);
    updateAccount(candidates.account);
    for (const item of candidates) {
      const previous = active.candidates.get(item.id);
      if (!previous && active.candidates.size >= WakuX.LIMIT) active.candidates.delete(active.candidates.keys().next().value);
      if (!previous || item.width * item.height >= previous.width * previous.height) active.candidates.set(item.id, item);
    }
    ingest(candidates.filter(item => active.images.has(item.id) || (video && item.id === video)));
  }
  function refreshFacebookReel() {
    if (!isFacebook) return;
    const id = WakuFacebook.videoId(location.href);
    if (id === lastFacebookVideo) return;
    lastFacebookVideo = id;
    if (facebookLookup) { clearTimeout(facebookLookup.timer); facebookLookup.controller.abort(); facebookLookup = null; }
    if (!id) return;
    // The stream and its owner may be delivered in either order before navigation.
    const saved = facebookReplay.filter(entry => entry.ids.includes(id));
    for (let pass = 0; pass < 2; pass++) for (const entry of saved) cacheFacebook(entry.data, true);
    window.postMessage({ type: "WAKU_READ_CACHE" }, location.origin);
    findFacebookReel(id);
  }
  function findFacebookReel(id, force = false) {
    if (!id || id !== WakuFacebook.videoId(location.href)) return;
    if (!force && active?.images.has(id) && currentHandle()) return;
    if (facebookLookup?.id === id && ["queued", "loading"].includes(facebookLookup.status)) return;
    if (facebookLookup) { clearTimeout(facebookLookup.timer); facebookLookup.controller.abort(); }
    const lookup = { id, controller: new AbortController(), status: "queued", timer: null };
    facebookLookup = lookup;
    lookup.timer = setTimeout(async () => {
      if (disposed || WakuFacebook.videoId(location.href) !== id) return;
      if (!force && active?.images.has(id) && currentHandle()) { lookup.status = "done"; publish(); return; }
      lookup.status = "loading"; publish();
      const timeout = setTimeout(() => lookup.controller.abort(), 20000);
      try {
        const response = await fetch(`/watch/?v=${encodeURIComponent(id.slice(1))}`, { credentials: "include", headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }, signal: lookup.controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!WakuFacebook.isFacebook(response.url)) throw new Error("Trang Facebook không hợp lệ");
        const length = Number(response.headers.get("content-length"));
        if (length > 8000000) throw new Error("Dữ liệu trang quá lớn");
        const html = await response.text();
        if (html.length > 8000000 || facebookLookup !== lookup || WakuFacebook.videoId(location.href) !== id) return;
        const data = [];
        for (const script of html.matchAll(/<script\b(?=[^>]*\btype\s*=\s*['"]application\/json['"])[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
          const text = script[1];
          if (text.length > 2000000 || !text.includes(id.slice(1))) continue;
          try { data.push(JSON.parse(text)); } catch {}
        }
        // Facebook can place author and video in different script blocks.
        for (let pass = 0; pass < 2; pass++) for (const item of data) {
          if (facebookLookup !== lookup || WakuFacebook.videoId(location.href) !== id) return;
          cacheFacebook(item, pass > 0);
        }
      } catch { /* The page may be private, unavailable or no longer current. */ }
      finally {
        clearTimeout(timeout);
        if (facebookLookup === lookup) { lookup.status = "done"; publish(); }
      }
    }, force ? 0 : 500);
    publish();
  }
  function updateAccount(account) {
    if (!active || !account || !/^\d{1,25}$/.test(account.id || "")) return;
    let changed = false;
    if (active.profileId !== account.id) { active.profileId = account.id; changed = true; }
    if (account.name && (active.name === active.handle || !active.name)) { active.name = account.name; changed = true; }
    if (changed) { persist(active); publish(); }
  }
  function readFacebookScripts() {
    // Initial profile data can be embedded in the document before GraphQL requests.
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      if (seenFacebookScripts.has(script)) continue;
      const text = script.textContent || "";
      if (!text) continue;
      if (text.length > 2_000_000) { seenFacebookScripts.add(script); continue; }
      if (!/"(?:Photo|Video|photo_image|legacy_fbid|User|Page|Profile|dash_manifest|video_dash_manifest|manifest_xml|progressive_url)"/.test(text)) {
        if (document.readyState === "complete") seenFacebookScripts.add(script);
        continue;
      }
      try {
        const data = JSON.parse(text);
        seenFacebookScripts.add(script);
        cacheFacebook(data);
      } catch {
        // An HTML stream may still be filling this script; retry until page load.
        if (document.readyState === "complete") seenFacebookScripts.add(script);
      }
    }
  }
  async function pixivGet(path) {
    if (pixivPageData.has(path)) return pixivPageData.get(path);
    const response = await fetch(path, { credentials: "include", signal: lifecycle.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.error || !data.body) throw new Error(data.message || "Pixiv không trả về dữ liệu");
    return data.body;
  }
  function cachePixiv(data, rawUrl) {
    let path;
    try {
      const url = new URL(rawUrl, location.origin);
      if (url.origin !== location.origin) return;
      path = url.pathname.replace(/\/$/, "");
    } catch { return; }
    const match = path.match(/^\/ajax\/illust\/(\d+)(\/ugoira_meta)?$/);
    if (!match || data?.error || !data?.body || typeof data.body !== "object") return;
    if (pixivPageData.size >= 200) pixivPageData.delete(pixivPageData.keys().next().value);
    pixivPageData.set(path, data.body);
    const id = match[1], info = pixivPageData.get(`/ajax/illust/${id}`), meta = pixivPageData.get(`/ajax/illust/${id}/ugoira_meta`);
    if (!info || !meta || Number(info.illustType) !== 2) return;
    const owner = WakuPixiv.handle(String(info.userId || ""));
    if (!owner) return;
    if (WakuPixiv.artwork(location.href) === id) { pixivArtwork = { id, owner }; syncProfile(); }
    if (!active || active.handle !== owner || (WakuPixiv.artwork(location.href) !== id && !active.pixivPending.has(id))) return;
    if (WakuPixiv.artwork(location.href) === id) active.pixivRestricted = Number(info.xRestrict) > 0;
    if (info.userName) active.name = String(info.userName).slice(0, 80);
    ingest([{ kind: "video", id: `${id}_ugoira`, tweetId: id, handle: owner, url: meta.originalSrc || meta.src, frames: meta.frames, thumbnail: info.urls?.small || "", text: info.title, date: info.createDate }]);
    if (active.images.has(`${id}_ugoira`) && WakuPixiv.artwork(location.href) === id) { active.pixivErrors = 0; pixivLookupError = 0; publish(); }
  }
  function resolvePixivArtwork() {
    const id = WakuPixiv.artwork(location.href);
    if (!id || pixivArtwork?.id === id || pixivLookup?.id === id || pixivLookupFailed === id) return;
    const lookup = { id };
    pixivLookup = lookup;
    pixivLookupError = 0;
    publish();
    void pixivGet(`/ajax/illust/${id}`).then(info => {
      const owner = WakuPixiv.handle(String(info.userId || ""));
      if (!owner) throw new Error("Không xác định được tác giả Pixiv");
      if (WakuPixiv.artwork(location.href) !== id || pixivLookup !== lookup) return;
      pixivArtwork = { id, owner };
      syncProfile();
      if (!active.pixivPending.has(id)) active.pixivPending.set(id, { thumbnail: "", status: "queued", info });
      pumpPixiv(active);
      publish();
    }).catch(error => {
      if (!disposed && error.name !== "AbortError" && WakuPixiv.artwork(location.href) === id) { pixivLookupFailed = id; pixivLookupError = 1; publish(); }
    }).finally(() => { if (pixivLookup === lookup) pixivLookup = null; });
  }
  async function loadPixivWork(collection, id, thumbnail, preloadedInfo) {
    try {
      const info = preloadedInfo || await pixivGet(`/ajax/illust/${id}`);
      if (String(info.userId) !== collection.handle) return;
      if (WakuPixiv.artwork(location.href) === id) collection.pixivRestricted = Number(info.xRestrict) > 0;
      if (Number(info.illustType) === 2) {
        const meta = await pixivGet(`/ajax/illust/${id}/ugoira_meta`);
        if (active !== collection || currentHandle() !== collection.handle) { collection.pixivPending.get(id).status = "queued"; return; }
        if (info.userName) collection.name = String(info.userName).slice(0, 80);
        ingest([{ kind: "video", id: `${id}_ugoira`, tweetId: id, handle: collection.handle, url: meta.originalSrc || meta.src, frames: meta.frames, thumbnail: info.urls?.small || thumbnail, text: info.title, date: info.createDate }]);
        return;
      }
      const pages = await pixivGet(`/ajax/illust/${id}/pages`);
      if (!Array.isArray(pages)) return;
      if (active !== collection || currentHandle() !== collection.handle) { collection.pixivPending.get(id).status = "queued"; return; }
      if (info.userName && collection.name !== info.userName) { collection.name = String(info.userName).slice(0, 80); persist(collection); publish(); }
      ingest(pages.slice(0, WakuX.LIMIT).map((page, index) => ({ url: page.urls?.original, thumbnail: page.urls?.small || thumbnail, id: `${id}_p${index}`, tweetId: id, handle: collection.handle, text: info.title, date: info.createDate })));
    } catch (error) {
      if (!disposed && error.name !== "AbortError") { collection.pixivErrors = (collection.pixivErrors || 0) + 1; publish(); }
    }
  }
  function readPixiv() {
    const primary = document.querySelector("main") || document.body;
    if (!primary) return;
    const name = primary.querySelector("h1")?.textContent?.trim();
    if (name && active.name === active.handle) { active.name = name.slice(0, 80); persist(active); publish(); }
    if (WakuPixiv.artwork(location.href)) { pumpPixiv(active); return; }
    for (const link of primary.querySelectorAll('a[href*="/artworks/"]')) {
      const id = WakuPixiv.artwork(link.href);
      if (!id || active.pixivPending.has(id)) continue;
      const collection = active;
      const thumbnail = link.querySelector("img")?.src || "";
      // Limit concurrent requests while collecting every card that has appeared in the DOM.
      collection.pixivPending.set(id, { thumbnail, status: "queued" });
    }
    pumpPixiv(active);
  }
  function pumpPixiv(collection) {
    if (active !== collection || disposed) return;
    let running = [...collection.pixivPending.values()].filter(entry => entry.status === "running").length;
    for (const [id, entry] of collection.pixivPending) {
      if (running >= 3) break;
      if (entry.status !== "queued") continue;
      entry.status = "running"; running++;
      void loadPixivWork(collection, id, entry.thumbnail, entry.info).finally(() => { if (entry.status === "running") entry.status = "done"; pumpPixiv(collection); });
    }
  }
  function pumpXVideos(collection) {
    if (active !== collection || disposed) return;
    let running = [...collection.xVideoPending.values()].filter(value => value === "running").length;
    for (const [tweetId, status] of collection.xVideoPending) {
      if (running >= 3) break;
      if (status !== "queued") continue;
      if ([...collection.images.values()].some(item => item.kind === "video" && item.tweetId === tweetId)) { collection.xVideoPending.set(tweetId, "done"); continue; }
      collection.xVideoPending.set(tweetId, "running"); running++;
      void send({ type: "RESOLVE_X_VIDEO", handle: collection.handle, tweetId }).then(result => {
        if (active === collection && currentHandle()?.toLowerCase() === collection.handle.toLowerCase()) ingest(result?.items || []);
        else collection.xVideoPending.set(tweetId, "queued");
      }).catch(() => {}).finally(() => {
        if (collection.xVideoPending.get(tweetId) === "running") collection.xVideoPending.set(tweetId, "done");
        pumpXVideos(collection);
      });
    }
  }
  function readDOM() {
    refreshFacebookReel();
    if (isPixiv && WakuPixiv.artwork(location.href)) resolvePixivArtwork();
    if (isFacebook && WakuFacebook.videoId(location.href)) readFacebookScripts();
    syncProfile();
    if (!active || !currentHandle()) return;
    if (isPixiv) { readPixiv(); return; }
    if (isFacebook) {
      if (WakuFacebook.videoId(location.href)) return;
      if (!WakuFacebook.isPhotos(location.href)) return;
      const primary = document.querySelector('[role="main"]') || document.querySelector("main");
      if (!primary) return;
      readFacebookScripts();
      const name = primary.querySelector("h1")?.textContent?.trim() || document.querySelector("h1")?.textContent?.trim();
      if (name && active.name !== name) { active.name = name.slice(0, 80); persist(active); publish(); }
      const items = [];
      for (const link of primary.querySelectorAll('a[href*="/videos/"],a[href*="/reel/"],a[href*="/watch/"]')) {
        const id = WakuFacebook.videoId(link.href);
        const candidate = id && active.candidates.get(id);
        if (candidate) items.push(candidate);
      }
      for (const link of primary.querySelectorAll('a[href*="photo"]')) {
        const id = WakuFacebook.photoId(link.href);
        if (!id || link.querySelector('video, [aria-label*="video" i]')) continue;
        for (const image of link.querySelectorAll("img")) {
          const candidates = [{ url: image.currentSrc || image.src, width: image.naturalWidth || 0 }];
          for (const part of (image.srcset || "").split(",")) {
            const match = part.trim().match(/^(\S+)\s+(\d+)w$/);
            if (match) candidates.push({ url: match[1], width: Number(match[2]) });
          }
          candidates.sort((a, b) => b.width - a.width);
          const best = candidates.find(candidate => WakuFacebook.photo(candidate.url));
          if (best) items.push({ id, handle: active.handle, url: best.url, width: best.width, height: image.naturalHeight || 0, text: image.alt || "", source: "dom" });
        }
      }
      ingest(items);
      return;
    }
    const primary = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector("main");
    if (!primary) return;
    const username = primary.querySelector('[data-testid="UserName"]');
    const name = (username?.querySelector("span")?.textContent || username?.textContent)?.split("\n")[0]?.trim();
    const avatar = primary.querySelector('img[src*="pbs.twimg.com/profile_images/"]')?.src;
    if ((name && name !== active.name) || (avatar && avatar !== active.avatar)) {
      if (name) active.name = name.slice(0, 80);
      if (avatar) active.avatar = avatar;
      persist(active); publish();
    }
    const items = [];
    for (const article of primary.querySelectorAll('article:has(video),article:has([data-testid="videoPlayer"]),article:has([data-testid="videoComponent"])')) {
      for (const link of article.querySelectorAll('a[href*="/status/"]')) {
        const match = link.pathname.match(/^\/([\w]{1,15})\/status\/(\d+)(?:\/|$)/);
        if (!match || match[1].toLowerCase() !== active.handle.toLowerCase() || active.xVideoPending.has(match[2])) continue;
        active.xVideoPending.set(match[2], "queued");
        break;
      }
    }
    // The media grid can show only a thumbnail, before X creates a video player.
    for (const image of primary.querySelectorAll('img[src*="pbs.twimg.com/ext_tw_video_thumb/"],img[src*="pbs.twimg.com/amplify_video_thumb/"],img[src*="pbs.twimg.com/tweet_video_thumb/"]')) {
      const link = image.closest('a[href*="/status/"]');
      const match = link?.pathname.match(/^\/([\w]{1,15})\/status\/(\d+)(?:\/|$)/);
      if (match && match[1].toLowerCase() === active.handle.toLowerCase() && !active.xVideoPending.has(match[2])) active.xVideoPending.set(match[2], "queued");
    }
    pumpXVideos(active);
    for (const image of primary.querySelectorAll('img[src*="pbs.twimg.com/media/"]')) {
      const link = image.closest('a[href*="/status/"]');
      const match = link?.pathname.match(/^\/([\w]{1,15})\/status\/(\d+)(?:\/photo\/\d+)?\/?$/);
      if (!match || link.querySelector('video, [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="playButton"]')) continue;
      const article = image.closest("article");
      items.push({ url: image.currentSrc || image.src, handle: match[1], tweetId: match[2], text: article?.querySelector('[data-testid="tweetText"]')?.textContent || "", date: article?.querySelector("time")?.dateTime || "", source: "dom" });
    }
    ingest(items);
  }
  function scheduleRead() {
    if (!contextReady() || scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; readDOM(); }, 180);
  }
  function setCollapsed(value) {
    if (!contextReady()) return;
    panelInteracted = true;
    collapsed = value;
    if (!host) return;
    host.classList.toggle("collapsed", value);
    frame.hidden = value;
    launcher.hidden = !value;
    void send({ type: "PANEL_COLLAPSED", collapsed: value }).catch(() => {});
    if (!value) publish();
  }
  function applyLauncherPosition(position) {
    launcherPosition = { side: position?.side === "left" ? "left" : "right", top: Number.isFinite(Number(position?.top)) ? Math.max(0, Number(position.top)) : 16 };
    if (!host) return;
    host.classList.toggle("left", launcherPosition.side === "left");
    const top = `${launcherPosition.top}px`;
    if (host.style.getPropertyValue("--waku-top") !== top) host.style.setProperty("--waku-top", top);
  }
  function setupLauncherDrag() {
    let drag = null;
    let suppressClick = false;
    launcher.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const rect = host.getBoundingClientRect();
      drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, moved: false };
      launcher.setPointerCapture(event.pointerId);
    }, { signal: lifecycle.signal });
    launcher.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      host.classList.add("dragging");
      host.style.setProperty("--waku-drag-x", `${Math.max(0, Math.min(window.innerWidth - 38, drag.x + dx))}px`);
      host.style.setProperty("--waku-top", `${Math.max(0, Math.min(window.innerHeight - 38, drag.y + dy))}px`);
    }, { signal: lifecycle.signal });
    const finish = event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.moved) {
        const rect = host.getBoundingClientRect();
        const position = { side: rect.left + rect.width / 2 < window.innerWidth / 2 ? "left" : "right", top: rect.top };
        suppressClick = event.type === "pointerup";
        if (suppressClick) setTimeout(() => { suppressClick = false; }, 0);
        positionRevision++;
        host.classList.remove("dragging");
        applyLauncherPosition(position);
        void send({ type: "PANEL_POSITION", position }).catch(() => {});
      }
      drag = null;
    };
    launcher.addEventListener("pointerup", finish, { signal: lifecycle.signal });
    launcher.addEventListener("pointercancel", finish, { signal: lifecycle.signal });
    launcher.addEventListener("click", event => {
      if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
      setCollapsed(false);
    }, { signal: lifecycle.signal });
  }
  function mount() {
    if (!contextReady() || !enabled || !document.documentElement || host?.isConnected) return;
    host = document.createElement("div");
    host.id = "waku-panel";
    host.dataset.wakuVersion = CONTENT_VERSION;
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `:host{all:initial!important;position:fixed!important;right:12px!important;top:16px!important;bottom:16px!important;width:min(380px,calc(100vw - 24px))!important;z-index:2147483646!important;display:block!important;color-scheme:dark!important}:host(.left){left:12px!important;right:auto!important}:host(.collapsed){right:4px!important;top:min(var(--waku-top,16px),max(0px,calc(100vh - 38px)))!important;bottom:auto!important;width:38px!important;height:38px!important}:host(.collapsed.left){left:4px!important;right:auto!important}:host(.collapsed.dragging){left:var(--waku-drag-x)!important;right:auto!important}iframe{border:0!important;width:100%!important;height:100%!important;display:block;border-radius:12px;box-shadow:0 8px 38px #0004;background:#111318}button{all:initial;box-sizing:border-box;display:grid;place-items:center;width:38px;height:38px;border-radius:10px;box-shadow:0 4px 20px #0006;color:white;cursor:grab;touch-action:none;user-select:none}button:active{cursor:grabbing}button:hover{filter:brightness(1.15)}button:focus-visible{outline:3px solid #a5afff;outline-offset:3px}button svg{width:100%;height:100%;display:block}[hidden]{display:none!important}`;
    frame = document.createElement("iframe");
    frame.title = "Waku Download — bảng tải ảnh";
    frame.src = `${extensionBase}panel.html#${encodeURIComponent(location.origin)}`;
    launcher = document.createElement("button");
    launcher.id = "waku-launcher";
    launcher.innerHTML = '<svg viewBox="0 0 128 128" aria-hidden="true"><rect x="2" y="2" width="124" height="124" rx="29" fill="#24243b" stroke="#5c5481" stroke-width="4"/><path d="M17 37 26 90 41 59 55 90 65 37M94 37v51M82 75l12 14 12-14" fill="none" stroke="#c5bfff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    launcher.title = `Mở Waku Download ${CONTENT_VERSION} · Kéo để chuyển vị trí`;
    launcher.setAttribute("aria-label", "Mở lại bảng tải ảnh");
    setupLauncherDrag();
    root.append(style, frame, launcher);
    applyLauncherPosition(launcherPosition);
    host.classList.toggle("collapsed", collapsed);
    frame.hidden = collapsed;
    launcher.hidden = !collapsed;
    document.documentElement.append(host);
  }
  function command(message) {
    if (message.command === "COLLAPSE") { setCollapsed(true); return; }
    if (message.command === "RESCAN_FACEBOOK") { findFacebookReel(WakuFacebook.videoId(location.href), true); return; }
    if (!active) return;
    if (message.command === "SCROLL") {
      active.scrollTop = Math.max(0, Math.min(1000000, Number(message.scrollTop) || 0));
      persist(active);
      return;
    }
    active.selectionRevision++;
    if (message.command === "SELECT") {
      for (const id of (message.ids || []).slice(0, WakuX.LIMIT)) {
        if (!active.images.has(id)) continue;
        if (message.selected) active.selected.add(id); else active.selected.delete(id);
      }
    }
    if (message.command === "SELECT_ALL") {
      const shown = snapshot().items;
      if (shown.length < active.images.size) {
        for (const item of shown) if (message.selected) active.selected.add(item.id); else active.selected.delete(item.id);
      } else {
        active.selectNew = !!message.selected;
        active.selected = new Set(message.selected ? active.images.keys() : []);
      }
    }
    if (message.command === "SELECT_NEW") active.selectNew = !!message.selected;
    persist(active); publish();
  }
  window.addEventListener("message", event => {
    if (!contextReady()) return;
    if (event.source === window && event.origin === location.origin && event.data?.type === "WAKU_DATA") {
      if (isFacebook) {
        syncProfile();
        cacheFacebook(event.data.data, !!event.data.replay);
        scheduleRead();
      } else if (isPixiv) {
        cachePixiv(event.data.data, event.data.url);
      } else {
        syncProfile();
        const items = WakuX.extract(event.data.data, active?.handle);
        updateAccount(items.account);
        ingest(items);
      }
      return;
    }
    if (!frame || event.source !== frame.contentWindow || event.origin !== extensionOrigin) return;
    if (event.data?.type === "WAKU_PANEL_READY") { panelReady = true; publish(); }
    if (event.data?.type === "WAKU_PANEL_COMMAND") command(event.data);
  }, { signal: lifecycle.signal });
  if (!registerChromeListener(() => chrome.runtime.onMessage, (message, _sender, reply) => {
    if (!contextReady()) return;
    if (message.type === "STATUS") { syncProfile(); reply({ ok: true, ...snapshot(), collapsed, enabled }); }
    if (message.type === "OPEN_PANEL") {
      enabled = true; collapsed = false; mount(); setCollapsed(false); scheduleRead();
      reply({ ok: true });
    }
  })) return;
  observer = new MutationObserver(scheduleRead);
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset", "href"] });
  window.addEventListener("scroll", scheduleRead, { passive: true, capture: true, signal: lifecycle.signal });
  window.addEventListener("popstate", () => { refreshFacebookReel(); scheduleRead(); publish(); }, { signal: lifecycle.signal });
  window.addEventListener("waku:navigate", () => { refreshFacebookReel(); scheduleRead(); publish(); }, { signal: lifecycle.signal });
  window.addEventListener("resize", () => applyLauncherPosition(launcherPosition), { signal: lifecycle.signal });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { scheduleRead(); publish(); } }, { signal: lifecycle.signal });
  window.addEventListener("pagehide", () => {
    for (const collection of collections.values()) {
      clearTimeout(collection.saveTimer);
      if (!collection.restoring) void send({ type: "SAVE_SCAN", state: savedState(collection) }).catch(() => {});
    }
  }, { signal: lifecycle.signal });
  watchTimer = setInterval(() => {
    if (!contextReady()) return;
    if (lastPath !== location.href) { lastPath = location.href; pixivLookupError = 0; pixivLookupFailed = null; refreshFacebookReel(); scheduleRead(); publish(); }
    if (enabled) mount();
  }, 1000);
  if (!registerChromeListener(() => chrome.storage.onChanged, (changes, area) => {
    if (!contextReady()) return;
    if (area === "local" && changes.panelEnabled?.newValue) { enabled = true; mount(); }
    if (area === "local" && changes.launcherPosition?.newValue) applyLauncherPosition(changes.launcherPosition.newValue);
  })) return;
  syncProfile();
  scheduleRead();
  void send({ type: "PANEL_INIT" }).then(result => {
    if (!contextReady()) return;
    enabled ||= !!result?.enabled;
    if (!panelInteracted) collapsed = true;
    if (!positionRevision && result?.position) applyLauncherPosition(result.position);
    mount();
    window.postMessage({ type: "WAKU_READ_CACHE" }, location.origin);
  }).catch(() => {});
})();
