/* Facebook photo parsing. Signed CDN URLs must be preserved exactly. */
(function (root) {
  "use strict";
  const RESERVED = new Set(["home", "login", "logout", "watch", "reel", "reels", "share", "photo", "photo.php", "photos", "groups", "events", "marketplace", "search", "settings", "messages", "notifications", "pages", "help", "stories", "gaming", "friends", "saved", "profile.php"]);
  const LIMIT = 5000;
  function isFacebook(value) {
    try { const url = new URL(value); return url.protocol === "https:" && /^(?:(?:www|web|m|mbasic)\.)?facebook\.com$/.test(url.hostname); } catch { return false; }
  }
  function handle(value) {
    const text = String(value || "");
    return /^[a-zA-Z0-9._-]{1,100}$/.test(text) && !RESERVED.has(text.toLowerCase()) && !/^\.+$/.test(text) ? text : null;
  }
  function profile(value) {
    if (!isFacebook(value)) return null;
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0]?.toLowerCase() === "profile.php") {
      const id = url.searchParams.get("id");
      return /^\d{1,25}$/.test(id || "") ? id : null;
    }
    if (parts.length > 1 && !["photos", "photos_by", "photos_albums", "videos", "reels"].includes(parts[1].toLowerCase())) return null;
    return handle(parts[0]);
  }
  function isPhotos(value) {
    if (!isFacebook(value)) return false;
    const url = new URL(value);
    return !!profile(value) && (["photos", "videos", "reels"].includes(url.searchParams.get("sk")?.toLowerCase()) || /\/(?:photos|photos_by|photos_albums|videos|reels)(?:\/|$)/i.test(url.pathname));
  }
  function photo(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.port || !/(^|\.)fbcdn\.net$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/\.(jpe?g|png|webp)(?:\/)?$/i);
      if (!match || !url.pathname.startsWith("/v/")) return null;
      const format = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
      return { url: url.href, thumbnail: url.href, format };
    } catch { return null; }
  }
  function photoId(value) {
    try {
      const url = new URL(value, "https://www.facebook.com/");
      if (!isFacebook(url.href)) return null;
      const path = url.pathname.toLowerCase();
      if (path === "/photo/" || path === "/photo" || path === "/photo.php") {
        const id = url.searchParams.get("fbid");
        return /^\d{1,25}$/.test(id || "") ? id : null;
      }
      const match = path.match(/\/photos\/(?:a\.\d+\/)?(\d+)(?:\/|$)/);
      return match?.[1] || null;
    } catch { return null; }
  }
  function videoId(value) {
    try {
      const url = new URL(value, "https://www.facebook.com/");
      if (!isFacebook(url.href)) return null;
      const id = url.pathname.match(/\/(?:videos|reel)\/(\d+)(?:\/|$)/i)?.[1] || (/^\/watch\/?$/i.test(url.pathname) ? url.searchParams.get("v") : null);
      return /^\d{1,25}$/.test(id || "") ? `v${id}` : null;
    } catch { return null; }
  }
  function videoOwner(payload, targetId) {
    if (!/^v\d{1,25}$/.test(String(targetId || ""))) return null;
    const stack = [payload], visited = new WeakSet();
    let iterations = 0;
    while (stack.length && iterations++ < 100000) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || visited.has(node)) continue;
      visited.add(node);
      const type = node.__typename || node.__isMedia || node.__isNode;
      const raw = String(node.legacy_fbid || node.video_id || node.videoId || node.id || "");
      if ((type === "Video" || node.creation_story?.short_form_video_context) && `v${raw}` === targetId) {
        const actors = Array.isArray(node.creation_story?.actors) ? node.creation_story.actors : [];
        for (const owner of [node.owner, node.owning_profile, node.author, node.creation_story?.short_form_video_context?.video_owner, ...actors]) {
          if (!owner || typeof owner !== "object") continue;
          const linked = profile(owner.url || owner.profile_url || "");
          const id = String(owner.legacy_fbid || owner.profile_id || owner.user_id || owner.id || "");
          const result = linked || (/^\d{1,25}$/.test(id) ? id : handle(owner.username));
          if (result) return { handle: result, name: String(owner.name || "").slice(0,80) };
        }
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
    return null;
  }
  function videoIds(payload) {
    const ids = new Set(), stack = [payload], visited = new WeakSet();
    let iterations = 0;
    while (stack.length && iterations++ < 100000 && ids.size < 100) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || visited.has(node)) continue;
      visited.add(node);
      const type = node.__typename || node.__isMedia || node.__isNode;
      if (type === "Video" || node.dash_manifest || node.video_dash_manifest || node.creation_story?.short_form_video_context) {
        const id = String(node.legacy_fbid || node.video_id || node.videoId || node.id || "");
        if (/^\d{1,25}$/.test(id)) ids.add(`v${id}`);
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
    return [...ids];
  }
  function videoUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.port && /(^|\.)fbcdn\.net$/i.test(url.hostname) && /\.mp4$/i.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }
  function dashStreams(xml) {
    if (typeof xml !== "string" || xml.length > 2000000) return null;
    if (/^\s*%3c/i.test(xml)) { try { xml = decodeURIComponent(xml.replace(/\+/g, "%20")); } catch { return null; } }
    const attribute = (text, key) => text.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] || "";
    const decode = text => text.replace(/&amp;|&#38;|&#x26;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
    const choices = { video: [], audio: [] };
    let hasAudio = false;
    for (const group of xml.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet\s*>/gi)) {
      for (const rep of group[2].matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation\s*>/gi)) {
        const attrs = `${group[1]} ${rep[1]}`;
        const mime = attribute(rep[1], "mimeType") || attribute(group[1], "mimeType");
        const type = attribute(rep[1], "contentType") || attribute(group[1], "contentType") || mime.split("/")[0];
        const codec = attribute(rep[1], "codecs") || attribute(group[1], "codecs");
        if (type === "audio") hasAudio = true;
        if (!(type === "video" || type === "audio") || (codec && !(type === "video" ? /^(avc1|avc3)/i : /^mp4a/i).test(codec))) continue;
        const base = rep[2].match(/<BaseURL(?:\s[^>]*)?>([\s\S]*?)<\/BaseURL\s*>/i)?.[1]?.trim();
        const url = videoUrl(decode(base || ""));
        if (url) choices[type].push({ url, bandwidth: Number(attribute(rep[1], "bandwidth")) || 0 });
      }
    }
    for (const list of Object.values(choices)) list.sort((a, b) => b.bandwidth - a.bandwidth);
    return choices.video.length && (!hasAudio || choices.audio.length) ? { url: choices.video[0].url, audioUrl: choices.audio[0]?.url || null } : null;
  }
  function normalize(item, owner) {
    if (item?.kind === "video") {
      try {
        const url = videoUrl(item.url), id = String(item.id || "");
        const audioUrl = item.audioUrl ? videoUrl(item.audioUrl) : null;
        if (!handle(owner) || String(item.handle || "").toLowerCase() !== owner.toLowerCase() || !/^v\d{1,25}$/.test(id) || !url || (item.audioUrl && !audioUrl)) return null;
        const thumbnail = photo(item.thumbnail)?.url || "";
        return { kind: "video", platform: "facebook", id, handle: owner, tweetId: id.slice(1), url, ...(item.videoMode === "dash" ? { videoMode: "dash", audioUrl } : {}), thumbnail, format: "mp4", text: String(item.text || "").slice(0,300), date: String(item.date || "").slice(0,60), source: "api", width: Number(item.width) || 0, height: Number(item.height) || 0 };
      } catch { return null; }
    }
    const image = photo(item?.url);
    if (!image || !handle(owner) || String(item.handle || "").toLowerCase() !== owner.toLowerCase()) return null;
    const id = String(item.id || "");
    if (!/^\d{1,25}$/.test(id)) return null;
    return { ...image, platform: "facebook", id, handle: owner, tweetId: id, text: String(item.text || "").slice(0, 300), date: String(item.date || "").slice(0, 60), source: item.source === "api" ? "api" : "dom", width: Math.min(30000, Math.max(0, Number(item.width) || 0)), height: Math.min(30000, Math.max(0, Number(item.height) || 0)) };
  }
  function extract(payload, owner) {
    if (!handle(owner)) return [];
    const images = new Map();
    let account = null;
    const visited = new WeakSet();
    const stack = [payload];
    let iterations = 0;
    while (stack.length && iterations++ < 100000 && images.size < LIMIT) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || visited.has(node)) continue;
      visited.add(node);
      const type = node.__typename || node.__isMedia || node.__isNode;
      const isPhoto = type === "Photo" || (!!node.legacy_fbid && !!node.photo_image && !/video/i.test(String(type || "")));
      if (["User", "Page", "Profile"].includes(type)) {
        const rawId = node.legacy_fbid || node.profile_id || node.user_id || node.id || "";
        const id = typeof rawId === "string" || Number.isSafeInteger(rawId) ? String(rawId) : "";
        const username = String(node.username || node.vanity || "");
        const linkedProfile = profile(node.url || node.profile_url || "");
        const matches = /^\d+$/.test(owner) ? id === owner : username.toLowerCase() === owner.toLowerCase() || linkedProfile?.toLowerCase() === owner.toLowerCase();
        if (matches && /^\d{1,25}$/.test(id)) account = { id, name: String(node.name || "").slice(0, 120) };
      }
      if (isPhoto) {
        const rawId = String(node.legacy_fbid || node.photo_id || node.id || "");
        const id = /^\d{1,25}$/.test(rawId) ? rawId : photoId(node.url || node.photo_url || "");
        if (id) {
          const candidates = [];
          // Only image-bearing fields on this photo, never arbitrary nested profile data.
          for (const [priority, key] of ["original_image", "image", "photo_image", "viewer_image", "large_image", "images", "thumbnail"].entries()) {
            const values = Array.isArray(node[key]) ? node[key] : [node[key]];
            for (const value of values) {
              const url = typeof value === "string" ? value : value?.uri || value?.url;
              const parsed = photo(url);
              if (parsed) candidates.push({ ...parsed, width: Number(value?.width) || 0, height: Number(value?.height) || 0, priority });
            }
          }
          candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height) || a.priority - b.priority);
          const best = candidates[0];
          if (best) {
            const timestamp = Number(node.creation_time);
            const date = Number.isFinite(timestamp) && timestamp > 0 && timestamp < 8640000000000 ? new Date(timestamp * 1000).toISOString() : "";
            const item = normalize({ ...best, id, handle: owner, text: node.message?.text || node.accessibility_caption || "", date, source: "api" }, owner);
            const previous = images.get(id);
            if (item && (!previous || item.width * item.height > previous.width * previous.height)) images.set(id, item);
          }
        }
      }
      if (type === "Video" || node.dash_manifest || node.video_dash_manifest || node.creation_story?.short_form_video_context) {
        const id = String(node.legacy_fbid || node.video_id || node.videoId || node.id || "");
        const playback = node.creation_story?.short_form_video_context?.playback_video || node;
        const legacy = playback.videoDeliveryLegacyFields || playback;
        const delivery = playback.videoDeliveryResponseFragment?.videoDeliveryResponseResult || {};
        const progressive = Array.isArray(delivery.progressive_urls) ? [...delivery.progressive_urls].sort((a, b) => Number(/hd/i.test(b.metadata?.quality || "")) - Number(/hd/i.test(a.metadata?.quality || ""))).map(item => item.progressive_url) : [];
        const direct = [legacy.browser_native_hd_url, legacy.playable_url_quality_hd, ...progressive, legacy.browser_native_sd_url, legacy.playable_url].map(videoUrl).find(Boolean);
        const manifests = [legacy.dash_manifest, legacy.video_dash_manifest, legacy.playlist, legacy.dash_manifest_xml_string, ...(Array.isArray(delivery.dash_manifests) ? delivery.dash_manifests.map(item => item.manifest_xml) : [])];
        const streams = direct ? null : manifests.map(dashStreams).find(Boolean);
        const thumb = node.preferred_thumbnail?.image?.uri || node.thumbnailImage?.uri || node.thumbnail?.uri || "";
        const item = /^\d{1,25}$/.test(id) && normalize({ kind: "video", id: `v${id}`, handle: owner, url: direct || streams?.url, videoMode: streams ? "dash" : undefined, audioUrl: streams?.audioUrl, thumbnail: thumb, text: node.title?.text || node.message?.text || "", source: "api" }, owner);
        if (item) images.set(item.id, item);
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
    const result = [...images.values()];
    result.account = account;
    return result;
  }
  function filename(item, legacy = false) {
    const clean = normalize(item, item?.handle);
    if (!clean) throw new Error("Ảnh Facebook không hợp lệ.");
    return `${legacy ? "FacebookDownload" : "WakuDownload/Facebook"}/${clean.handle}/${clean.kind === "video" ? clean.id.slice(1) : clean.id}.${clean.format}`;
  }
  root.WakuFacebook = Object.freeze({ isFacebook, handle, profile, isPhotos, photo, photoId, videoId, videoIds, videoOwner, videoUrl, dashStreams, normalize, extract, filename, LIMIT });
})(globalThis);
