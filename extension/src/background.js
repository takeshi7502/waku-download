importScripts("platforms/x.js", "platforms/facebook.js", "platforms/pixiv.js");

let job = null;
let history = {};
let serial = Promise.resolve();
let scanSerial = Promise.resolve();
let offscreenCreation = null;
const HISTORY_LIMIT = 20000;
const RETRY_DELAYS = [5000, 15000];
const archiveKey = item => `${item.platform === "facebook" ? "facebook:" : item.platform === "pixiv" ? "pixiv:" : ""}${item.handle.toLowerCase()}:${item.id}`;
const ready = chrome.storage.local.get(["job", "history"]).then(saved => {
  job = saved.job || null;
  history = saved.history || {};
});
function exclusive(task) {
  const result = serial.then(() => ready).then(task);
  serial = result.catch(() => {});
  return result;
}
function exclusiveScan(task) {
  const result = scanSerial.then(task);
  scanSerial = result.catch(() => {});
  return result;
}
function summary() {
  if (!job) return null;
  const count = status => job.items.filter(item => item.status === status).length;
  return { id: job.id, handle: job.handle, platform: job.platform || "x", pathVersion: job.pathVersion || 1, folderCount: job.folderCount ?? null, total: job.items.length, done: count("complete"), failed: count("failed"), active: count("active") + count("preparing"), queued: count("queued"), waiting: count("waiting"), cancelled: count("cancelled"), status: job.status, skipped: job.skipped, sourceStatus: job.source?.status || null, sourceError: job.source?.error || "", errors: job.items.filter(item => item.status === "failed").slice(0, 3).map(item => item.error) };
}
function errorDetail(error, platform) {
  const raw = String(error || "");
  if (/SERVER_FORBIDDEN|HTTP\s*(401|403)/i.test(raw)) return platform === "facebook" ? "Facebook từ chối truy cập hoặc link đã hết hạn. Tải lại trang và cuộn lại." : platform === "pixiv" ? "Pixiv từ chối truy cập. Kiểm tra quyền xem rồi tải lại trang." : "Máy chủ từ chối truy cập. Tải lại trang rồi thử lại.";
  if (/SERVER_BAD_CONTENT|SERVER_NO_RANGE|HTTP\s*404/i.test(raw)) return "Không tìm thấy nội dung hoặc link không còn hiệu lực. Tải lại trang rồi thử lại.";
  if (/NETWORK|SERVER_UNREACHABLE|FAILED TO FETCH|LOAD FAILED|TIMEOUT|TIMED OUT/i.test(raw)) return "Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.";
  if (/HTTP\s*429|SERVER_TOO_MANY_REQUESTS/i.test(raw)) return "Máy chủ đang giới hạn lượt tải. Đợi một lúc rồi thử lại.";
  if (/HTTP\s*5\d\d|SERVER_FAILED/i.test(raw)) return "Máy chủ tạm thời gặp lỗi. Hãy thử lại sau.";
  if (/FILE_NO_SPACE/i.test(raw)) return "Ổ đĩa đã hết dung lượng. Giải phóng dung lượng rồi thử lại.";
  if (/FILE_ACCESS_DENIED|FILE_SECURITY_CHECK_FAILED/i.test(raw)) return "Không thể ghi file. Kiểm tra quyền và thư mục tải xuống.";
  return raw || "Tải bị gián đoạn. Hãy thử lại.";
}
function transient(error) {
  return /NETWORK_(?:FAILED|DISCONNECTED|TIMEOUT|SERVER_DOWN)|FAILED TO FETCH|LOAD FAILED|TIMED OUT|HTTP\s*(?:408|429|5\d\d)|SERVER_(?:FAILED|UNREACHABLE|TOO_MANY_REQUESTS)/i.test(String(error || ""));
}
function photoPath(item) {
  const legacy = job.pathVersion !== 2;
  const path = (item.platform === "pixiv" ? WakuPixiv.filename(item) : item.platform === "facebook" ? WakuFacebook.filename(item, legacy) : WakuX.filename(item, legacy)).split("/");
  if (Number.isInteger(job.folderCount) && job.folderCount > 0 && job.folderCount <= WakuX.LIMIT) path[legacy ? 1 : 2] += ` (${job.folderCount})`;
  return path.join("/");
}
function sourceText(source, platform, handle) {
  const id = (platform === "facebook" || platform === "pixiv") && /^\d{1,25}$/.test(handle) ? handle : source.profileId;
  const profileUrl = platform === "pixiv" ? `https://www.pixiv.net/users/${handle}` : platform === "facebook"
    ? id ? `https://www.facebook.com/profile.php?id=${id}` : `https://www.facebook.com/${handle}`
    : id ? `https://x.com/i/user/${id}` : `https://x.com/${handle}`;
  const lines = ["NGUỒN ẢNH / VIDEO", `Nền tảng: ${platform === "pixiv" ? "Pixiv" : platform === "facebook" ? "Facebook" : "X"}`, `Tên: ${source.name}`, `Tài khoản: ${platform === "x" ? "@" : ""}${handle}`];
  if (id) lines.push(`ID: ${id}`);
  lines.push(`Link hồ sơ: ${profileUrl}`);
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
function settleSource(state, error) {
  if (!job?.source) return;
  if (state === "complete") { job.source.status = "complete"; job.source.error = ""; }
  else if (state === "interrupted") { job.source.status = "failed"; job.source.error = errorDetail(error, job.platform); }
}
async function save() {
  const keys = Object.keys(history);
  if (keys.length > HISTORY_LIMIT) for (const key of keys.slice(0, keys.length - HISTORY_LIMIT)) delete history[key];
  await chrome.storage.local.set({ job, history });
}
function settle(item, state, error) {
  if ((state === "complete" || state === "interrupted") && item.blobUrl) {
    void chrome.runtime.sendMessage({ target: "pixiv-offscreen", type: "REVOKE", url: item.blobUrl }).catch(() => {});
    item.blobUrl = null;
  }
  if (state === "complete") {
    item.status = "complete";
    history[archiveKey(item.photo)] = Date.now();
  } else if (state === "interrupted" && item.status !== "cancelled") {
    const retries = item.retries || 0;
    item.error = errorDetail(error, item.photo.platform || "x");
    if (job?.status !== "cancelled" && transient(error) && retries < RETRY_DELAYS.length) {
      item.retries = retries + 1;
      item.retryAt = Date.now() + RETRY_DELAYS[retries];
      item.status = "waiting";
      item.downloadId = null;
    } else item.status = "failed";
  }
}
async function pixivBlob(url, photo) {
  if (!offscreenCreation) offscreenCreation = (async () => {
    const exists = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument() : (await clients.matchAll()).some(client => client.url === chrome.runtime.getURL("offscreen.html"));
    if (!exists) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["BLOBS"], justification: "Tải ảnh gốc Pixiv và cung cấp dữ liệu cho trình quản lý tải." });
  })().finally(() => { offscreenCreation = null; });
  await offscreenCreation;
  const result = await chrome.runtime.sendMessage({ target: "pixiv-offscreen", type: "FETCH", url, kind: photo?.kind, frames: photo?.frames });
  if (!result?.ok) throw new Error(result?.error || "Không thể lấy ảnh gốc Pixiv.");
  return result.url;
}
async function facebookBlob(photo) {
  if (!offscreenCreation) offscreenCreation = (async () => {
    const exists = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument() : (await clients.matchAll()).some(client => client.url === chrome.runtime.getURL("offscreen.html"));
    if (!exists) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["BLOBS"], justification: "Ghép video Facebook trên máy và cung cấp dữ liệu cho trình quản lý tải." });
  })().finally(() => { offscreenCreation = null; });
  await offscreenCreation;
  const result = await chrome.runtime.sendMessage({ target: "pixiv-offscreen", type: "FETCH_FACEBOOK_DASH", url: photo.url, audioUrl: photo.audioUrl });
  if (!result?.ok) throw new Error(result?.error || "Không thể tải video Facebook.");
  return result.url;
}
async function reconcile() {
  if (!job) return;
  for (const item of job.items.filter(item => item.status === "active")) {
    try {
      const [download] = await chrome.downloads.search({ id: item.downloadId });
      if (!download) settle(item, "interrupted", "Không còn thông tin lượt tải trong trình duyệt. Hãy thử lại.");
      else settle(item, download.state, download.error);
    } catch (error) { settle(item, "interrupted", error.message); }
  }
  if (job.source?.status === "active") {
    try {
      const [download] = await chrome.downloads.search({ id: job.source.downloadId });
      if (!download) { job.source.status = "failed"; job.source.error = "Không còn thông tin tệp nguồn."; }
      else settleSource(download.state, download.error);
    } catch (error) { job.source.status = "failed"; job.source.error = errorDetail(error.message, job.platform); }
  }
}
function revokeBlob(url) {
  if (url) void chrome.runtime.sendMessage({ target: "pixiv-offscreen", type: "REVOKE", url }).catch(() => {});
}
async function beginPixiv(item, jobId) {
  try {
    const url = item.photo.platform === "facebook" ? await facebookBlob(item.photo) : await pixivBlob(item.photo.url, item.photo);
    await exclusive(async () => {
      if (job?.id !== jobId || item.status !== "preparing") { revokeBlob(url); return; }
      item.blobUrl = url;
      try {
        item.downloadId = await chrome.downloads.download({ url, filename: photoPath(item.photo), saveAs: false, conflictAction: "uniquify" });
        item.status = "active";
      } catch (error) { settle(item, "interrupted", error.message); }
      if (job.status === "running") await pump(); else await save();
    });
  } catch (error) {
    await exclusive(async () => {
      if (job?.id !== jobId || item.status !== "preparing") return;
      settle(item, "interrupted", error.message);
      if (job.status === "running") await pump(); else await save();
    });
  }
}
async function pump() {
  if (!job || job.status !== "running") return;
  for (const item of job.items) if (item.status === "waiting" && item.retryAt <= Date.now()) item.status = "queued";
  let active = job.items.filter(item => item.status === "active" || item.status === "preparing").length;
  const prepare = [];
  for (const item of job.items) {
    if (active >= 3) break;
    if (item.status !== "queued") continue;
    try {
      if (item.photo.platform === "pixiv" || (item.photo.platform === "facebook" && item.photo.videoMode === "dash")) { item.status = "preparing"; prepare.push(item); }
      else { item.downloadId = await chrome.downloads.download({ url: item.photo.url, filename: photoPath(item.photo), saveAs: false, conflictAction: "uniquify" }); item.status = "active"; }
      active++;
    } catch (error) { settle(item, "interrupted", error.message); }
  }
  if (job.source?.status === "queued") {
    try {
      const folder = photoPath(job.items[0].photo).split("/").slice(0, -1).join("/");
      const url = "data:text/plain;charset=utf-8," + encodeURIComponent(sourceText(job.source, job.platform, job.handle));
      job.source.downloadId = await chrome.downloads.download({ url, filename: `${folder}/#nguon.txt`, saveAs: false, conflictAction: "uniquify" });
      job.source.status = "active";
      const [download] = await chrome.downloads.search({ id: job.source.downloadId });
      if (download) settleSource(download.state, download.error);
    } catch (error) { job.source.status = "failed"; job.source.error = errorDetail(error.message, job.platform); }
  }
  const retryAt = Math.min(...job.items.filter(item => item.status === "waiting").map(item => item.retryAt));
  if (Number.isFinite(retryAt)) await chrome.alarms.create("waku-retry", { when: retryAt });
  if (!job.items.some(item => ["queued", "active", "preparing", "waiting"].includes(item.status)) && !["queued", "active"].includes(job.source?.status)) {
    job.status = job.items.some(item => item.status === "failed") || job.source?.status === "failed" ? "finished_with_errors" : "complete";
  }
  // Fill free slots first, then checkpoint all started IDs in one storage write.
  await save();
  for (const item of prepare) void beginPixiv(item, job.id);
}
async function start(message) {
  if (["running", "paused"].includes(job?.status)) throw new Error("Đang có một lượt tải. Dừng hoặc đợi tải xong trước.");
  const platform = message.platform === "pixiv" ? "pixiv" : message.platform === "facebook" ? "facebook" : "x";
  const handle = platform === "pixiv" ? WakuPixiv.handle(message.handle) : platform === "facebook" ? WakuFacebook.handle(message.handle) : WakuX.profile(message.handle);
  if (!handle || !Array.isArray(message.items)) throw new Error("Danh sách tải không hợp lệ.");
  const unique = new Map();
  for (const raw of message.items.slice(0, WakuX.LIMIT)) {
    const item = platform === "pixiv" ? WakuPixiv.normalize(raw, handle) : platform === "facebook" ? WakuFacebook.normalize(raw, handle) : WakuX.normalize(raw, handle);
    if (item) unique.set(item.id, item);
  }
  if (!unique.size) throw new Error("Chưa chọn nội dung để tải.");
  let skipped = 0;
  const items = [];
  for (const photo of unique.values()) {
    if (message.skipSaved !== false && history[archiveKey(photo)]) { skipped++; continue; }
    items.push({ photo, status: "queued", downloadId: null });
  }
  const name = String(message.name || handle).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 120) || handle;
  const profileId = typeof message.profileId === "string" && /^\d{1,25}$/.test(message.profileId) ? message.profileId : null;
  job = { id: crypto.randomUUID(), platform, handle, items, skipped, pathVersion: 2, folderCount: items.length, status: "running", createdAt: Date.now(), source: items.length ? { name, profileId, status: "queued", downloadId: null, error: "" } : null };
  await pump();
  return summary();
}
const scanMessages = new Set(["LOAD_SCAN", "SAVE_SCAN", "PANEL_INIT", "PANEL_COLLAPSED", "PANEL_POSITION"]);
async function scanMessage(message, sender) {
  const tabId = sender.tab.id;
  if (message.type === "PANEL_INIT") {
    const settings = await chrome.storage.local.get("launcherPosition");
    return { enabled: true, collapsed: true, position: settings.launcherPosition || null };
  }
  if (message.type === "PANEL_POSITION") {
    const position = { side: message.position?.side === "left" ? "left" : "right", top: Math.max(0, Math.min(100000, Number(message.position?.top) || 0)) };
    await chrome.storage.local.set({ launcherPosition: position });
    return {};
  }
  if (message.type === "PANEL_COLLAPSED") {
    await chrome.storage.session.set({ [`panel:${tabId}`]: { collapsed: !!message.collapsed } });
    return {};
  }
  const isFacebook = WakuFacebook.isFacebook(sender.url);
  const isPixiv = WakuPixiv.isPixiv(sender.url);
  const handle = isPixiv ? WakuPixiv.handle(message.handle || message.state?.handle) : isFacebook ? WakuFacebook.handle(message.handle || message.state?.handle) : WakuX.profile(message.handle || message.state?.handle);
  if (!handle) throw new Error("Profile không hợp lệ.");
  const key = `scan:${tabId}:${isPixiv ? "pixiv:" : isFacebook ? "facebook:" : ""}${handle.toLowerCase()}`;
  if (message.type === "LOAD_SCAN") return { state: (await chrome.storage.session.get(key))[key] || null };
  const raw = message.state;
  const unique = new Map();
  for (const value of (Array.isArray(raw.items) ? raw.items : []).slice(0, WakuX.LIMIT)) {
    const item = isPixiv ? WakuPixiv.normalize(value, handle) : isFacebook ? WakuFacebook.normalize(value, handle) : WakuX.normalize(value, handle);
    if (item) unique.set(item.id, item);
  }
  const selected = (Array.isArray(raw.selected) ? raw.selected : []).slice(0, WakuX.LIMIT).filter(id => unique.has(id));
  let avatar = null;
  try { const url = new URL(raw.avatar); if (url.protocol === "https:" && url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/profile_images/")) avatar = url.href; } catch {}
  const profileId = /^\d{1,25}$/.test(String(raw.profileId || "")) ? String(raw.profileId) : null;
  await chrome.storage.session.set({ [key]: { platform: isPixiv ? "pixiv" : isFacebook ? "facebook" : "x", handle, profileId, items: [...unique.values()], selected, selectNew: raw.selectNew !== false, name: String(raw.name || handle).slice(0, 80), avatar, scrollTop: Math.max(0, Math.min(1000000, Number(raw.scrollTop) || 0)) } });
  return {};
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === "RESOLVE_X_VIDEO") {
    if (!sender.tab?.id || !/^https:\/\/(www\.)?(x|twitter)\.com\//.test(sender.url || "")) return;
    const handle = WakuX.profile(message.handle), tweetId = String(message.tweetId || "");
    if (!handle || !/^\d{1,25}$/.test(tweetId)) { reply({ ok: false }); return; }
    (async () => {
      async function request(url, parse) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
          return response.ok ? parse(await response.json(), handle, tweetId) : [];
        } catch { return []; }
        finally { clearTimeout(timer); }
      }
      const direct = await request(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=0`, WakuX.extractSyndication);
      if (direct.length) return direct;
      return request(`https://api.fxtwitter.com/${encodeURIComponent(handle)}/status/${tweetId}`, WakuX.extractFxTwitter);
    })().then(items => reply({ ok: true, items })).catch(() => reply({ ok: false, items: [] }));
    return true;
  }
  if (scanMessages.has(message.type)) {
    if (!sender.tab?.id || (!/^https:\/\/(www\.)?(x|twitter)\.com\//.test(sender.url || "") && !WakuFacebook.isFacebook(sender.url) && !WakuPixiv.isPixiv(sender.url))) return;
    // Serialize saves and restores so a quick reload cannot restore an older save.
    exclusiveScan(() => scanMessage(message, sender)).then(result => reply({ ok: true, ...result })).catch(error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (!sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  if (!["JOB", "DOWNLOAD", "PAUSE_DOWNLOAD", "RESUME_DOWNLOAD", "CANCEL_DOWNLOAD", "RETRY_DOWNLOAD"].includes(message.type)) return;
  exclusive(async () => {
    if (message.type === "JOB") return summary();
    if (message.type === "DOWNLOAD") return start(message);
    if (message.type === "PAUSE_DOWNLOAD" && job?.status === "running") { job.status = "paused"; await save(); }
    if (message.type === "RESUME_DOWNLOAD" && job?.status === "paused") job.status = "running";
    if (message.type === "CANCEL_DOWNLOAD" && ["running", "paused"].includes(job?.status)) {
      job.status = "cancelled";
      for (const item of job.items) {
        if (["queued", "waiting", "preparing"].includes(item.status)) item.status = "cancelled";
        if (item.status === "active") {
          // Reconcile first: a completed file must still enter the saved history.
          const [download] = await chrome.downloads.search({ id: item.downloadId });
          if (download?.state === "complete") settle(item, "complete");
          else { item.status = "cancelled"; await chrome.downloads.cancel(item.downloadId).catch(() => {}); settle(item, "interrupted", "Đã dừng tải."); }
        }
      }
      await save();
    }
    if (message.type === "RETRY_DOWNLOAD" && job && job.status !== "running") {
      for (const item of job.items) if (item.status === "failed") { item.status = "queued"; item.error = ""; item.downloadId = null; item.retries = 0; }
      if (job.source?.status === "failed") { job.source.status = "queued"; job.source.error = ""; job.source.downloadId = null; }
      job.status = "running";
    }
    await reconcile();
    await pump();
    return summary();
  }).then(result => reply({ ok: true, job: result })).catch(error => reply({ ok: false, error: error.message }));
  return true;
});
chrome.downloads.onChanged.addListener(delta => {
  if (!delta.state) return;
  void exclusive(async () => {
    if (job?.source?.downloadId === delta.id) {
      settleSource(delta.state.current, delta.error?.current);
      if (job.status === "running") await pump(); else await save();
      return;
    }
    const item = job?.items.find(item => item.downloadId === delta.id);
    if (!item) return;
    let error = delta.error?.current;
    if (delta.state.current === "interrupted" && !error) error = (await chrome.downloads.search({ id: delta.id }).catch(() => []))[0]?.error;
    settle(item, delta.state.current, error);
    if (job.status === "running") await pump();
    else await save();
  });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (!["waku-queue", "waku-retry"].includes(alarm.name)) return;
  void exclusive(async () => { await reconcile(); if (job?.status === "paused") await save(); else await pump(); });
});
// Alarms and download events wake the worker independently of panel visibility.
// Remove the pre-rename alarm so upgrading does not leave an extra recurring wakeup.
void chrome.alarms.clear("xdl-queue");
void chrome.alarms.create("waku-queue", { periodInMinutes: 1 });
void exclusive(async () => { if (job) for (const item of job.items) if (item.status === "preparing") item.status = "queued"; await reconcile(); await pump(); if (job?.status === "paused") await save(); });

chrome.action?.onClicked.addListener(tab => {
  void (async () => {
    if (!tab.id) return;
    if (!/^https:\/\/(www\.)?(x|twitter)\.com\//.test(tab.url || "") && !WakuFacebook.isFacebook(tab.url) && !WakuPixiv.isPixiv(tab.url)) {
      await chrome.tabs.create({ url: "https://x.com/" });
      await chrome.storage.local.set({ panelEnabled: true });
      return;
    }
    await chrome.storage.local.set({ panelEnabled: true });
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "OPEN_PANEL" });
      await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    } catch {
      await chrome.action.setBadgeText({ tabId: tab.id, text: "↻" });
      await chrome.action.setTitle({ tabId: tab.id, title: "Tải lại tab để dùng phiên bản mới" });
    }
  })().catch(() => {});
});
chrome.tabs?.onRemoved?.addListener(tabId => {
  void exclusiveScan(async () => {
    const saved = await chrome.storage.session.get(null);
    const keys = Object.keys(saved).filter(key => key === `panel:${tabId}` || key.startsWith(`scan:${tabId}:`));
    if (keys.length) await chrome.storage.session.remove(keys);
  }).catch(() => {});
});
