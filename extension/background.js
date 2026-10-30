importScripts("core.js", "facebook.js");

let job = null;
let history = {};
let serial = Promise.resolve();
let scanSerial = Promise.resolve();
const HISTORY_LIMIT = 20000;
const archiveKey = item => `${item.platform === "facebook" ? "facebook:" : ""}${item.handle.toLowerCase()}:${item.id}`;
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
  return { id: job.id, handle: job.handle, platform: job.platform || "x", pathVersion: job.pathVersion || 1, folderCount: job.folderCount ?? null, total: job.items.length, done: count("complete"), failed: count("failed"), active: count("active"), queued: count("queued"), cancelled: count("cancelled"), status: job.status, skipped: job.skipped, errors: job.items.filter(item => item.status === "failed").slice(0, 3).map(item => item.error) };
}
async function save() {
  const keys = Object.keys(history);
  if (keys.length > HISTORY_LIMIT) for (const key of keys.slice(0, keys.length - HISTORY_LIMIT)) delete history[key];
  await chrome.storage.local.set({ job, history });
}
function settle(item, state, error) {
  if (state === "complete") {
    item.status = "complete";
    history[archiveKey(item.photo)] = Date.now();
  } else if (state === "interrupted") {
    if (item.status !== "cancelled") item.status = "failed";
    item.error = error || "Tải bị gián đoạn.";
  }
}
async function reconcile() {
  if (!job) return;
  for (const item of job.items.filter(item => item.status === "active")) {
    try {
      const [download] = await chrome.downloads.search({ id: item.downloadId });
      if (!download) { item.status = "failed"; item.error = "Không còn thông tin lượt tải trong trình duyệt."; }
      else settle(item, download.state, download.error);
    } catch (error) { item.status = "failed"; item.error = error.message; }
  }
}
async function pump() {
  if (!job || job.status !== "running") return;
  let active = job.items.filter(item => item.status === "active").length;
  for (const item of job.items) {
    if (active >= 3) break;
    if (item.status !== "queued") continue;
    try {
      const legacy = job.pathVersion !== 2;
      const path = (item.photo.platform === "facebook" ? XDLFB.filename(item.photo, legacy) : XDL.filename(item.photo, legacy)).split("/");
      // Existing jobs and retries keep the directory assigned when they started.
      if (Number.isInteger(job.folderCount) && job.folderCount > 0 && job.folderCount <= XDL.LIMIT) path[legacy ? 1 : 2] += ` (${job.folderCount})`;
      item.downloadId = await chrome.downloads.download({ url: item.photo.url, filename: path.join("/"), saveAs: false, conflictAction: "uniquify" });
      item.status = "active";
      active++;
    } catch (error) { item.status = "failed"; item.error = error.message; }
  }
  if (!job.items.some(item => item.status === "queued" || item.status === "active")) {
    job.status = job.items.some(item => item.status === "failed") ? "finished_with_errors" : "complete";
  }
  // Fill free slots first, then checkpoint all started IDs in one storage write.
  await save();
}
async function start(message) {
  if (job?.status === "running") throw new Error("Đang có một lượt tải. Dừng hoặc đợi tải xong trước.");
  const platform = message.platform === "facebook" ? "facebook" : "x";
  const handle = platform === "facebook" ? XDLFB.handle(message.handle) : XDL.profile(message.handle);
  if (!handle || !Array.isArray(message.items)) throw new Error("Danh sách ảnh không hợp lệ.");
  const unique = new Map();
  for (const raw of message.items.slice(0, XDL.LIMIT)) {
    const item = platform === "facebook" ? XDLFB.normalize(raw, handle) : XDL.normalize(raw, handle);
    if (item) unique.set(item.id, item);
  }
  if (!unique.size) throw new Error("Chưa chọn ảnh để tải.");
  let skipped = 0;
  const items = [];
  for (const photo of unique.values()) {
    if (message.skipSaved !== false && history[archiveKey(photo)]) { skipped++; continue; }
    items.push({ photo, status: "queued", downloadId: null });
  }
  job = { id: crypto.randomUUID(), platform, handle, items, skipped, pathVersion: 2, folderCount: items.length, status: "running", createdAt: Date.now() };
  await pump();
  return summary();
}
const scanMessages = new Set(["LOAD_SCAN", "SAVE_SCAN", "PANEL_INIT", "PANEL_COLLAPSED"]);
async function scanMessage(message, sender) {
  const tabId = sender.tab.id;
  if (message.type === "PANEL_INIT") {
    const [settings, ui] = await Promise.all([chrome.storage.local.get("panelEnabled"), chrome.storage.session.get(`panel:${tabId}`)]);
    return { enabled: !!settings.panelEnabled, collapsed: !!ui[`panel:${tabId}`]?.collapsed };
  }
  if (message.type === "PANEL_COLLAPSED") {
    await chrome.storage.session.set({ [`panel:${tabId}`]: { collapsed: !!message.collapsed } });
    return {};
  }
  const isFacebook = XDLFB.isFacebook(sender.url);
  const handle = isFacebook ? XDLFB.handle(message.handle || message.state?.handle) : XDL.profile(message.handle || message.state?.handle);
  if (!handle) throw new Error("Profile không hợp lệ.");
  const key = `scan:${tabId}:${isFacebook ? "facebook:" : ""}${handle.toLowerCase()}`;
  if (message.type === "LOAD_SCAN") return { state: (await chrome.storage.session.get(key))[key] || null };
  const raw = message.state;
  const unique = new Map();
  for (const value of (Array.isArray(raw.items) ? raw.items : []).slice(0, XDL.LIMIT)) {
    const item = isFacebook ? XDLFB.normalize(value, handle) : XDL.normalize(value, handle);
    if (item) unique.set(item.id, item);
  }
  const selected = (Array.isArray(raw.selected) ? raw.selected : []).slice(0, XDL.LIMIT).filter(id => unique.has(id));
  let avatar = null;
  try { const url = new URL(raw.avatar); if (url.protocol === "https:" && url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/profile_images/")) avatar = url.href; } catch {}
  await chrome.storage.session.set({ [key]: { platform: isFacebook ? "facebook" : "x", handle, items: [...unique.values()], selected, selectNew: raw.selectNew !== false, name: String(raw.name || handle).slice(0, 80), avatar, scrollTop: Math.max(0, Math.min(1000000, Number(raw.scrollTop) || 0)) } });
  return {};
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (scanMessages.has(message.type)) {
    if (!sender.tab?.id || (!/^https:\/\/(www\.)?(x|twitter)\.com\//.test(sender.url || "") && !XDLFB.isFacebook(sender.url))) return;
    // Serialize saves and restores so a quick reload cannot restore an older save.
    exclusiveScan(() => scanMessage(message, sender)).then(result => reply({ ok: true, ...result })).catch(error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (!sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  if (!["JOB", "DOWNLOAD", "CANCEL_DOWNLOAD", "RETRY_DOWNLOAD"].includes(message.type)) return;
  exclusive(async () => {
    if (message.type === "JOB") return summary();
    if (message.type === "DOWNLOAD") return start(message);
    if (message.type === "CANCEL_DOWNLOAD" && job?.status === "running") {
      job.status = "cancelled";
      for (const item of job.items) {
        if (item.status === "queued") item.status = "cancelled";
        if (item.status === "active") {
          // Reconcile first: a completed file must still enter the saved history.
          const [download] = await chrome.downloads.search({ id: item.downloadId });
          if (download?.state === "complete") settle(item, "complete");
          else { item.status = "cancelled"; await chrome.downloads.cancel(item.downloadId).catch(() => {}); }
        }
      }
      await save();
    }
    if (message.type === "RETRY_DOWNLOAD" && job && job.status !== "running") {
      for (const item of job.items) if (item.status === "failed") { item.status = "queued"; item.error = ""; item.downloadId = null; }
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
    const item = job?.items.find(item => item.downloadId === delta.id);
    if (!item) return;
    settle(item, delta.state.current, delta.error?.current);
    if (job.status === "running") await pump();
    else await save();
  });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== "xdl-queue") return;
  void exclusive(async () => { await reconcile(); await pump(); });
});
// Alarms and download events wake the worker independently of panel visibility.
void chrome.alarms.create("xdl-queue", { periodInMinutes: 1 });
void exclusive(async () => { await reconcile(); await pump(); });

chrome.action?.onClicked.addListener(tab => {
  void (async () => {
    if (!tab.id) return;
    if (!/^https:\/\/(www\.)?(x|twitter)\.com\//.test(tab.url || "") && !XDLFB.isFacebook(tab.url)) {
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
