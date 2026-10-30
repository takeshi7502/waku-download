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
  function normalize(item, handle) {
    const image = photo(item?.url);
    if (!image || !profile(handle) || String(item.handle).toLowerCase() !== handle.toLowerCase()) return null;
    if (!/^\d{1,25}$/.test(String(item.tweetId))) return null;
    return { ...image, handle, tweetId: String(item.tweetId), text: String(item.text || "").slice(0, 300), date: String(item.date || "").slice(0, 60), source: item.source === "api" ? "api" : "dom" };
  }
  function extract(payload) {
    const images = new Map();
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
      if (handle && tweetId && legacy?.extended_entities?.media) {
        for (const media of legacy.extended_entities.media) {
          if (media.type !== "photo") continue;
          const item = normalize({ url: media.media_url_https, handle, tweetId, text: legacy.full_text, date: legacy.created_at, source: "api" }, handle);
          if (item) images.set(`${handle.toLowerCase()}:${item.id}`, item);
        }
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
    return [...images.values()];
  }
  function filename(item, legacy = false) {
    const clean = normalize(item, item?.handle);
    if (!clean) throw new Error("Ảnh không hợp lệ.");
    return `${legacy ? "XDownload" : "WakuDownload/X"}/${clean.handle}/${clean.tweetId}_${clean.id}.${clean.format}`;
  }
  root.WakuX = Object.freeze({ profile, photo, normalize, extract, filename, LIMIT });
})(globalThis);
