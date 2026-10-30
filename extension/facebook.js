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
    if (parts.length > 1 && !["photos", "photos_by", "photos_albums"].includes(parts[1].toLowerCase())) return null;
    return handle(parts[0]);
  }
  function isPhotos(value) {
    if (!isFacebook(value)) return false;
    const url = new URL(value);
    return !!profile(value) && (url.searchParams.get("sk")?.toLowerCase() === "photos" || /\/(?:photos|photos_by|photos_albums)(?:\/|$)/i.test(url.pathname));
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
  function normalize(item, owner) {
    const image = photo(item?.url);
    if (!image || !handle(owner) || String(item.handle || "").toLowerCase() !== owner.toLowerCase()) return null;
    const id = String(item.id || "");
    if (!/^\d{1,25}$/.test(id)) return null;
    return { ...image, platform: "facebook", id, handle: owner, tweetId: id, text: String(item.text || "").slice(0, 300), date: String(item.date || "").slice(0, 60), source: item.source === "api" ? "api" : "dom", width: Math.min(30000, Math.max(0, Number(item.width) || 0)), height: Math.min(30000, Math.max(0, Number(item.height) || 0)) };
  }
  function extract(payload, owner) {
    if (!handle(owner)) return [];
    const images = new Map();
    const visited = new WeakSet();
    const stack = [payload];
    let iterations = 0;
    while (stack.length && iterations++ < 100000 && images.size < LIMIT) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || visited.has(node)) continue;
      visited.add(node);
      const type = node.__typename || node.__isMedia || node.__isNode;
      const isPhoto = type === "Photo" || (!!node.legacy_fbid && !!node.photo_image && !/video/i.test(String(type || "")));
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
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
    return [...images.values()];
  }
  function filename(item, legacy = false) {
    const clean = normalize(item, item?.handle);
    if (!clean) throw new Error("Ảnh Facebook không hợp lệ.");
    return `${legacy ? "FacebookDownload" : "WakuDownload/Facebook"}/${clean.handle}/${clean.id}.${clean.format}`;
  }
  root.XDLFB = Object.freeze({ isFacebook, handle, profile, isPhotos, photo, photoId, normalize, extract, filename, LIMIT });
})(globalThis);
