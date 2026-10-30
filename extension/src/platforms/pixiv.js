/* Pixiv artwork pages provide the exact original URL for each page. */
(function (root) {
  "use strict";
  function isPixiv(value) { try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "www.pixiv.net"; } catch { return false; } }
  function handle(value) { return /^\d{1,25}$/.test(String(value || "")) ? String(value) : null; }
  function profile(value) {
    if (!isPixiv(value)) return null;
    const u = new URL(value);
    const match = u.pathname.match(/^\/(?:[a-z]{2}\/)?users\/(\d+)(?:\/(?:artworks|illustrations|manga))?\/?$/i);
    return handle(match?.[1] || (u.pathname === "/member.php" ? u.searchParams.get("id") : null));
  }
  function artwork(value) { try { const u = new URL(value, "https://www.pixiv.net"); if (!isPixiv(u.href)) return null; return u.pathname.match(/^\/(?:[a-z]{2}\/)?artworks\/(\d+)\/?$/i)?.[1] || null; } catch { return null; } }
  function image(value, original = false) {
    try {
      const u = new URL(value);
      if (u.protocol !== "https:" || u.hostname !== "i.pximg.net" || u.port || (original && !/^\/img-original\/img\//.test(u.pathname))) return null;
      const m = u.pathname.match(/\.(jpg|jpeg|png|webp)$/i);
      if (!m) return null;
      return { url: u.href, format: m[1].toLowerCase().replace("jpeg", "jpg") };
    } catch { return null; }
  }
  function normalize(item, owner) {
    const parsed = image(item?.url, true);
    const id = String(item?.id || ""), work = String(item?.tweetId || "");
    if (!parsed || !handle(owner) || item.handle !== owner || !/^\d{1,25}$/.test(work) || !new RegExp(`^${work}_p\\d{1,5}$`).test(id)) return null;
    if (!new URL(parsed.url).pathname.endsWith(`/${id}.${parsed.format}`) && !(parsed.format === "jpg" && new URL(parsed.url).pathname.endsWith(`/${id}.jpeg`))) return null;
    const thumb = image(item.thumbnail);
    return { ...parsed, thumbnail: thumb?.url || parsed.url, platform: "pixiv", id, handle: owner, tweetId: work, text: String(item.text || "").slice(0, 300), date: String(item.date || "").slice(0, 60), source: "api" };
  }
  function filename(item) { const clean = normalize(item, item?.handle); if (!clean) throw new Error("Ảnh Pixiv không hợp lệ."); return `WakuDownload/Pixiv/${clean.handle}/${clean.id}.${clean.format}`; }
  root.WakuPixiv = Object.freeze({ isPixiv, handle, profile, artwork, image, normalize, filename });
})(globalThis);
