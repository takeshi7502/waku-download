"use strict";
// Blob URLs must live in an extension document, not an MV3 service worker.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target !== "pixiv-offscreen" || sender.id !== chrome.runtime.id) return;
  if (message.type === "REVOKE") { URL.revokeObjectURL(message.url); reply({ ok: true }); return; }
  if (message.type !== "FETCH") return;
  (async () => {
    const parsed = new URL(message.url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "i.pximg.net" || !parsed.pathname.startsWith("/img-original/img/")) throw new Error("URL ảnh Pixiv không hợp lệ.");
    const response = await fetch(parsed.href, { credentials: "omit" });
    if (!response.ok) throw new Error(`Pixiv trả lỗi HTTP ${response.status}.`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || !blob.size) throw new Error("Pixiv không trả về dữ liệu ảnh hợp lệ.");
    return URL.createObjectURL(blob);
  })().then(url => reply({ ok: true, url })).catch(error => reply({ ok: false, error: error.message }));
  return true;
});
