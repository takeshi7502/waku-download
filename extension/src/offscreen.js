"use strict";
// Blob URLs must live in an extension document, not an MV3 service worker.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target !== "pixiv-offscreen" || sender.id !== chrome.runtime.id) return;
  if (message.type === "REVOKE") { URL.revokeObjectURL(message.url); reply({ ok: true }); return; }
  if (!["FETCH", "FETCH_FACEBOOK_DASH"].includes(message.type)) return;
  (async () => {
    if (message.type === "FETCH_FACEBOOK_DASH") {
      const urls = [message.url, message.audioUrl].filter(Boolean);
      const blobs = await Promise.all(urls.map(async value => {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.port || !/(^|\.)fbcdn\.net$/i.test(url.hostname) || !/\.mp4$/i.test(url.pathname)) throw new Error("URL video Facebook không hợp lệ.");
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
        try {
          const response = await fetch(url.href, { credentials: "omit", signal: controller.signal });
          if (!response.ok) throw new Error(`Facebook trả lỗi HTTP ${response.status}.`);
          const length = Number(response.headers.get("content-length"));
          if (length > 300 * 1024 * 1024) throw new Error("Video Facebook quá lớn để ghép trong trình duyệt.");
          const blob = await response.blob();
          if (!blob.size || blob.size > 300 * 1024 * 1024) throw new Error("Luồng Facebook rỗng hoặc quá lớn.");
          return blob;
        } catch (error) { if (error.name === "AbortError") throw new Error("NETWORK_TIMEOUT"); throw error; }
        finally { clearTimeout(timer); }
      }));
      const { muxFacebook } = await import("./facebook-mux.js");
      return URL.createObjectURL(await muxFacebook(blobs[0], blobs[1]));
    }
    const parsed = new URL(message.url);
    const video = message.kind === "video";
    if (parsed.protocol !== "https:" || parsed.hostname !== "i.pximg.net" || !(video ? /^\/img-zip-ugoira\/img\/.*_ugoira[0-9x]+\.zip$/.test(parsed.pathname) : parsed.pathname.startsWith("/img-original/img/"))) throw new Error("URL Pixiv không hợp lệ.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(parsed.href, { credentials: "omit", signal: controller.signal });
      if (!response.ok) throw new Error(`Pixiv trả lỗi HTTP ${response.status}.`);
      const blob = await response.blob();
      if (!blob.size || blob.size > 150 * 1024 * 1024) throw new Error("Dữ liệu Pixiv rỗng hoặc vượt quá 150 MB.");
      if (video) return URL.createObjectURL(await encodeUgoira(blob, message.frames));
      if (!blob.type.startsWith("image/")) throw new Error("Pixiv không trả về dữ liệu ảnh hợp lệ.");
      return URL.createObjectURL(blob);
    } catch (error) {
      if (error.name === "AbortError") throw new Error("NETWORK_TIMEOUT");
      throw error;
    } finally { clearTimeout(timer); }
  })().then(url => reply({ ok: true, url })).catch(error => reply({ ok: false, error: error.message }));
  return true;
});

async function encodeUgoira(zip, frames) {
  if (!Array.isArray(frames) || !frames.length || frames.length > 2000 || frames.some(f => !/^\d{1,8}\.(jpg|jpeg|png|webp)$/i.test(f.file) || !Number.isFinite(f.delay) || f.delay < 10 || f.delay > 60000)) throw new Error("Dữ liệu khung hình Ugoira không hợp lệ.");
  const wanted = new Set(frames.map(f => f.file));
  let size = 0;
  const files = fflate.unzipSync(new Uint8Array(await zip.arrayBuffer()), { filter: file => {
    if (!wanted.has(file.name)) return false;
    size += file.originalSize;
    if (size > 300 * 1024 * 1024) throw new Error("Ugoira quá lớn để xử lý trong trình duyệt.");
    return true;
  } });
  const canvas = document.createElement("canvas");
  const first = files[frames[0].file];
  if (!first) throw new Error("Thiếu khung hình Ugoira.");
  const image = await createImageBitmap(new Blob([first]));
  if (image.width > 8192 || image.height > 8192) { image.close(); throw new Error("Kích thước Ugoira vượt giới hạn trình duyệt."); }
  canvas.width = image.width; canvas.height = image.height;
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  const target = new WebMMuxer.ArrayBufferTarget();
  const muxer = new WebMMuxer.Muxer({ target, video: { codec: "V_VP8", width: canvas.width, height: canvas.height } });
  let encoderError;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: error => { encoderError = error; } });
  try {
    encoder.configure({ codec: "vp8", width: canvas.width, height: canvas.height, bitrate: 12000000, framerate: 30 });
    let timestamp = 0;
    for (let i = 0; i < frames.length; i++) {
      const bytes = files[frames[i].file];
      if (!bytes) throw new Error("Thiếu khung hình Ugoira.");
      const bitmap = i === 0 ? image : await createImageBitmap(new Blob([bytes]));
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const frame = new VideoFrame(canvas, { timestamp, duration: frames[i].delay * 1000 });
      encoder.encode(frame, { keyFrame: i % 60 === 0 }); frame.close();
      timestamp += frames[i].delay * 1000;
      if (encoder.encodeQueueSize > 4) await encoder.flush();
      if (encoderError) throw encoderError;
    }
    const last = new VideoFrame(canvas, { timestamp, duration: 1000 });
    encoder.encode(last); last.close();
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    return new Blob([target.buffer], { type: "video/webm" });
  } finally { if (encoder.state !== "closed") encoder.close(); canvas.remove(); }
}
