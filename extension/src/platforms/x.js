/* Shared, dependency-free parsing. Used in the page, content script and worker. */
(function (root) {
  "use strict";
  const RESERVED = new Set(["home", "explore", "notifications", "messages", "i", "search", "settings", "compose", "login", "logout", "signup", "intent", "share", "tos", "privacy", "jobs"]);
  const LIMIT = 5000;
  function profile(value) {
    const input = String(value || "").trim();
    if (/^@?[a-zA-Z0-9_]{1,15}$/.test(input)) {
      const handle = input.replace(/^@/, "");
      return RESERVED.has(handle.toLowerCase()) ? null : handle;
    }
    try {
      const url = new URL(input);
      if (url.protocol !== "https:" || !/^(www\.)?(x|twitter)\.com$/.test(url.hostname)) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length > 2 || (parts[1] && parts[1] !== "media")) return null;
      return profile(parts[0] || "");
    } catch { return null; }
  }
  function photo(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com") return null;
      const match = url.pathname.match(/^\/media\/([a-zA-Z0-9_-]+)(?:\.(jpg|jpeg|png|webp))?(?::[a-zA-Z0-9]+)?$/);
      if (!match) return null;
      let format = (url.searchParams.get("format") || match[2] || "jpg").toLowerCase();
      if (!["jpg", "jpeg", "png", "webp"].includes(format)) return null;
      if (format === "jpeg") format = "jpg";
      return { id: match[1], format, url: `https://pbs.twimg.com/media/${match[1]}?format=${format}&name=orig`, thumbnail: `https://pbs.twimg.com/media/${match[1]}?format=${format}&name=small` };
    } catch { return null; }
  }
  function videoId(media, tweetId, url) {
    const raw = String(media.id_str || media.media_key?.split("_").pop() || "");
    if (/^\d{1,25}$/.test(raw)) return `v${raw}`;
    try {
      const id = new URL(url).pathname.match(/\/(?:ext_tw_video|tweet_video|amplify_video)\/(\d+)\//)?.[1];
      if (id) return `v${id}`;
    } catch {}
    return /^\d{1,25}$/.test(String(tweetId || "")) ? `v${tweetId}` : "";
  }
  function normalize(item, handle) {
    if (item?.kind === "video") {
      try {
        const url = new URL(item.url), thumb = item.thumbnail ? new URL(item.thumbnail) : null;
        const id = String(item.id || ""), tweetId = String(item.tweetId || "");
        if (!profile(handle) || String(item.handle).toLowerCase() !== handle.toLowerCase() || !/^\d{1,25}$/.test(tweetId) || !/^v\d{1,25}$/.test(id) || url.protocol !== "https:" || url.hostname !== "video.twimg.com" || !/\.mp4$/i.test(url.pathname) || (thumb && (thumb.protocol !== "https:" || thumb.hostname !== "pbs.twimg.com"))) return null;
        return { kind: "video", id, handle, tweetId, url: url.href, thumbnail: thumb?.href || "", format: "mp4", text: String(item.text || "").slice(0,300), date: String(item.date || "").slice(0,60), source: "api" };
      } catch { return null; }
    }
    const image = photo(item?.url);
    if (!image || !profile(handle) || String(item.handle).toLowerCase() !== handle.toLowerCase()) return null;
    if (!/^\d{1,25}$/.test(String(item.tweetId))) return null;
    return { ...image, handle, tweetId: String(item.tweetId), text: String(item.text || "").slice(0, 300), date: String(item.date || "").slice(0, 60), source: item.source === "api" ? "api" : "dom" };
  }
  function extract(payload, targetHandle) {
    const images = new Map();
    let account = null;
    const visited = new WeakSet();
    const stack = [payload];
    let iterations = 0;
    while (stack.length && iterations++ < 100000 && images.size < LIMIT) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || visited.has(node)) continue;
      visited.add(node);
      const legacy = node.legacy;
      const user = node.core?.user_results?.result;
      const handle = user?.core?.screen_name || user?.legacy?.screen_name;
      const tweetId = node.rest_id || legacy?.id_str;
      for (const candidate of [node, user]) {
        const username = candidate?.core?.screen_name || candidate?.legacy?.screen_name;
        const rawId = candidate?.rest_id || candidate?.legacy?.id_str || "";
        const id = typeof rawId === "string" || Number.isSafeInteger(rawId) ? String(rawId) : "";
        if (targetHandle && typeof username === "string" && username.toLowerCase() === targetHandle.toLowerCase() && /^\d{1,25}$/.test(id)) {
          account = { id, name: String(candidate.core?.name || candidate.legacy?.name || "").slice(0, 120) };
        }
      }
      if (handle && tweetId) {
        for (const media of [...(legacy?.entities?.media || []), ...(legacy?.extended_entities?.media || [])]) {
          const variants = (media.video_info?.variants || []).filter(v => v.content_type === "video/mp4" && v.url).sort((a,b) => (b.bitrate || 0) - (a.bitrate || 0));
          if (media.type !== "photo" && !(media.type === "video" || media.type === "animated_gif") || (media.type !== "photo" && !variants.length)) continue;
          const item = normalize({ kind: media.type === "photo" ? "photo" : "video", id: videoId(media, tweetId, variants[0]?.url), url: media.type === "photo" ? media.media_url_https : variants[0].url, thumbnail: media.media_url_https, handle, tweetId, text: legacy.full_text, date: legacy.created_at, source: "api" }, handle);
          if (item) images.set(`${handle.toLowerCase()}:${item.id}`, item);
        }
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
    const result = [...images.values()];
    result.account = account;
    return result;
  }
  function extractSyndication(payload, targetHandle, targetTweetId) {
    const handle = payload?.user?.screen_name;
    const tweetId = String(payload?.id_str || "");
    if (!profile(targetHandle) || String(handle || "").toLowerCase() !== targetHandle.toLowerCase() || tweetId !== String(targetTweetId) || !/^\d{1,25}$/.test(tweetId)) return [];
    const results = [];
    for (const media of Array.isArray(payload.mediaDetails) ? payload.mediaDetails : []) {
      if (media.type !== "video" && media.type !== "animated_gif") continue;
      const variants = (media.video_info?.variants || []).filter(v => v.content_type === "video/mp4" && v.url).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const url = variants[0]?.url;
      if (!url) continue;
      const item = normalize({ kind: "video", id: videoId(media, tweetId, url), url, thumbnail: media.media_url_https, handle, tweetId, text: payload.text, date: payload.created_at, source: "api" }, targetHandle);
      if (item) results.push(item);
    }
    if (!results.length && Array.isArray(payload.video?.variants)) {
      const quality = v => { const size = String(v.src || v.url || "").match(/\/(\d+)x(\d+)\//); return Number(v.bitrate) || (size ? Number(size[1]) * Number(size[2]) : 0); };
      const variants = payload.video.variants.filter(v => (v.type || v.content_type) === "video/mp4" && (v.src || v.url)).sort((a, b) => quality(b) - quality(a));
      const url = variants[0]?.src || variants[0]?.url;
      if (url) {
        const item = normalize({ kind: "video", id: videoId({}, tweetId, url), url, thumbnail: payload.video.poster || "", handle, tweetId, text: payload.text, date: payload.created_at }, targetHandle);
        if (item) results.push(item);
      }
    }
    return results;
  }
  function extractFxTwitter(payload, targetHandle, targetTweetId) {
    const tweet = payload?.tweet;
    const handle = tweet?.author?.screen_name;
    const tweetId = String(tweet?.id || "");
    if (!profile(targetHandle) || String(handle || "").toLowerCase() !== targetHandle.toLowerCase() || tweetId !== String(targetTweetId) || !/^\d{1,25}$/.test(tweetId)) return [];
    const results = [];
    for (const media of Array.isArray(tweet.media?.all) ? tweet.media.all : []) {
      if (media.type !== "video" && media.type !== "gif") continue;
      const variants = (Array.isArray(media.variants) ? media.variants : []).filter(v => v.content_type === "video/mp4" && v.url).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const url = variants[0]?.url || media.url;
      if (!url) continue;
      const item = normalize({ kind: "video", id: videoId({ id_str: media.id }, tweetId, url), url, thumbnail: media.thumbnail_url || "", handle, tweetId, text: tweet.text, date: tweet.created_at }, targetHandle);
      if (item) results.push(item);
    }
    return results;
  }
  function filename(item, legacy = false) {
    const clean = normalize(item, item?.handle);
    if (!clean) throw new Error("Ảnh không hợp lệ.");
    return `${legacy ? "XDownload" : "WakuDownload/X"}/${clean.handle}/${clean.tweetId}_${clean.id}.${clean.format}`;
  }
  root.WakuX = Object.freeze({ profile, photo, normalize, extract, extractSyndication, extractFxTwitter, filename, LIMIT });
})(globalThis);
