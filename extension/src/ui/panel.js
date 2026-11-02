"use strict";
const $ = id => document.getElementById(id);
const parentOrigin = (() => {
  try {
    const url = new URL(decodeURIComponent(location.hash.slice(1)));
    return url.protocol === "https:" && (/^(www\.)?(x|twitter)\.com$/.test(url.hostname) || WakuFacebook.isFacebook(url.href) || WakuPixiv.isPixiv(url.href)) ? url.origin : "";
  } catch { return ""; }
})();
let state = { items: [], selected: [], handle: null };
let currentJob = null;
let visible = 60;
let currentHandle = null;
let restoredScroll = false;
let scrollTimer, errorTimer;
const rows = new Map();
const busy = new Set();
const command = (name, data = {}) => {
  if (parentOrigin) parent.postMessage({ type: "WAKU_PANEL_COMMAND", command: name, ...data }, parentOrigin);
};
async function chromeCall(action) {
  try {
    if (!chrome.runtime?.id) throw new Error("Extension context invalidated.");
    return await action();
  } catch (error) {
    if (/extension context invalidated/i.test(error?.message || "")) {
      throw new Error("Tiện ích vừa được cập nhật. Tải lại tab để kết nối bản mới.");
    }
    throw error;
  }
}
async function worker(message) {
  const result = await chromeCall(() => chrome.runtime.sendMessage(message));
  if (!result?.ok) throw new Error(result?.error || "Không thể kết nối tiến trình tải.");
  return result;
}
function showError(error) {
  $("error").textContent = error.message || String(error);
  $("error").hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { $("error").hidden = true; }, 7000);
}
function groupPosts() {
  const posts = new Map();
  for (const item of state.items) {
    if (!posts.has(item.tweetId)) posts.set(item.tweetId, { id: item.tweetId, items: [], text: item.text, date: item.date });
    const post = posts.get(item.tweetId);
    post.items.push(item);
    if (item.text) post.text = item.text;
    if (item.date) post.date = item.date;
  }
  return [...posts.values()].sort((a, b) => a.id.length === b.id.length ? b.id.localeCompare(a.id) : b.id.length - a.id.length);
}
function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function createRow(post) {
  const element = document.createElement("article");
  element.className = "post";
  const photos = document.createElement("div");
  photos.className = "photos";
  const copy = document.createElement("div");
  copy.className = "post-copy";
  const heading = document.createElement("div");
  heading.className = "post-heading";
  const check = document.createElement("input");
  check.type = "checkbox";
  check.setAttribute("aria-label", `Chọn bài ${post.id}`);
  check.addEventListener("change", () => command("SELECT", { ids: row.post.items.map(item => item.id), selected: check.checked }));
  const title = document.createElement("h2");
  title.className = "post-title";
  const link = document.createElement("a");
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  title.append(link);
  heading.append(check, title);
  const download = document.createElement("button");
  download.className = "post-download";
  download.textContent = "↧";
  download.title = "Tải ảnh của bài này";
  download.setAttribute("aria-label", `Tải ảnh bài ${post.id}`);
  download.addEventListener("click", () => void startDownload(row.post.items));
  const meta = document.createElement("div");
  meta.className = "post-meta";
  const date = document.createElement("span");
  const count = document.createElement("span");
  meta.append(date);
  const tools = document.createElement("div");
  tools.className = "post-tools";
  tools.append(count, download);
  copy.append(heading, meta, tools);
  element.append(photos, copy);
  const row = { element, check, link, photos, date, count, download, images: new Map(), post };
  return row;
}
function renderRows(posts, selected) {
  const shown = new Set();
  const activePosts = posts.slice(0, visible);
  // Reuse existing rows and image nodes: incoming photos do not reload previews or reset scrolling.
  for (let index = 0; index < activePosts.length; index++) {
    const post = activePosts[index];
    shown.add(post.id);
    let row = rows.get(post.id);
    if (!row) { row = createRow(post); rows.set(post.id, row); }
    row.post = post;
    row.element.dataset.photoCount = Math.min(4, post.items.length);
    row.link.textContent = post.text || (state.platform === "facebook" ? `Ảnh Facebook ${post.id}` : `Bài đăng ${post.id}`);
    row.link.title = row.link.textContent;
    row.link.href = state.platform === "pixiv" ? `https://www.pixiv.net/artworks/${post.id}` : state.platform === "facebook" ? `https://www.facebook.com/photo/?fbid=${post.id}` : `https://x.com/${state.handle}/status/${post.id}`;
    row.date.textContent = formatDate(post.date) || `#${post.id}`;
    row.date.title = row.date.textContent;
    row.count.textContent = `${post.items.length} ảnh`;
    const chosen = post.items.filter(item => selected.has(item.id)).length;
    row.check.checked = chosen === post.items.length;
    row.check.indeterminate = chosen > 0 && chosen < post.items.length;
    row.download.disabled = ["running", "paused"].includes(currentJob?.status) || busy.has("download");
    for (const item of post.items) {
      let photo = row.images.get(item.id);
      if (!photo) {
        const label = document.createElement("label");
        label.className = "photo";
        const image = document.createElement("img");
        image.src = item.thumbnail;
        image.loading = "lazy";
        image.alt = "";
        image.addEventListener("error", () => { image.hidden = true; label.classList.add("failed"); });
        const check = document.createElement("input");
        check.type = "checkbox";
        check.setAttribute("aria-label", `Chọn ảnh ${item.id}`);
        check.addEventListener("change", () => command("SELECT", { ids: [item.id], selected: check.checked }));
        label.append(image, check);
        row.photos.append(label);
        photo = { label, check, image };
        row.images.set(item.id, photo);
      }
      if (photo.image.src !== item.thumbnail) { photo.image.hidden = false; photo.label.classList.remove("failed"); photo.image.src = item.thumbnail; }
      photo.check.checked = selected.has(item.id);
      photo.label.classList.toggle("selected", selected.has(item.id));
    }
    const current = $("rows").children[index];
    if (current !== row.element) $("rows").insertBefore(row.element, current || null);
  }
  for (const [id, row] of rows) if (!shown.has(id)) { row.element.remove(); rows.delete(id); }
}
function render() {
  if (currentHandle !== state.handle) {
    currentHandle = state.handle; visible = 60; restoredScroll = false;
    $("rows").replaceChildren(); rows.clear(); $("list").scrollTop = 0;
  }
  const selected = new Set(state.selected);
  const posts = groupPosts();
  $("profile-name").textContent = state.name || state.handle || "Mở một profile";
  $("profile-handle").textContent = state.handle ? `${state.platform === "facebook" ? "Facebook · " : "@"}${state.handle}` : "Tab Ảnh / Media";
  const avatar = $("avatar");
  try {
    const url = new URL(state.avatar);
    if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com" || !url.pathname.startsWith("/profile_images/")) throw new Error();
    avatar.hidden = false;
    if (avatar.src !== url.href) avatar.src = url.href;
  } catch { avatar.hidden = true; }
  $("post-count").textContent = state.platform === "facebook" ? "Facebook" : `${posts.length.toLocaleString("vi-VN")} bài`;
  $("image-count").textContent = `${state.items.length.toLocaleString("vi-VN")} ảnh`;
  $("selection-count").textContent = selected.size ? `Đã chọn ${selected.size}` : "Chọn tất cả";
  $("select-all").checked = !!state.items.length && selected.size === state.items.length;
  $("select-all").indeterminate = selected.size > 0 && selected.size < state.items.length;
  $("select-new").checked = state.selectNew !== false;
  $("hint").textContent = state.pixivErrors ? `Không lấy được ảnh gốc của ${state.pixivErrors} tác phẩm. Kiểm tra mạng và quyền xem, rồi tải lại trang.` : state.restoring ? "Đang khôi phục danh sách đã lưu…" : state.items.length >= state.limit ? `Đã đạt giới hạn ${state.limit} ảnh trong profile này.` : state.platform === "facebook" && !state.onPhotos ? "Mở tab Ảnh của profile Facebook để nhận ảnh." : !state.onProfile && state.handle ? "Đang giữ danh sách cũ. Mở profile để nhận thêm ảnh." : "Bạn cuộn trang, ảnh mới tự xuất hiện ở đây.";
  $("empty").hidden = !!state.items.length;
  $("more").hidden = posts.length <= visible;
  renderRows(posts, selected);
  if (!restoredScroll && !state.restoring && document.documentElement.clientHeight > 0) {
    $("list").scrollTop = state.scrollTop || 0;
    // Larger lists may need more rows to restore their saved scroll position.
    if (state.scrollTop > $("list").scrollTop + 100 && posts.length > visible) {
      visible = Math.min(posts.length, Math.max(visible, Math.ceil(state.scrollTop / 88) + 10));
      renderRows(posts, selected);
      $("list").scrollTop = state.scrollTop;
    }
    restoredScroll = true;
  }
  updateDownloadControls();
  $("download-label").textContent = selected.size ? `Tải ${selected.size.toLocaleString("vi-VN")} ảnh đã chọn` : "Chưa có ảnh để tải";
  renderDestination();
  renderJob();
}
function updateDownloadControls() {
  const locked = ["running", "paused"].includes(currentJob?.status) || busy.has("download");
  $("download").disabled = !state.selected.length || locked;
  for (const row of rows.values()) row.download.disabled = locked;
}
function updateProgress() {
  updateDownloadControls();
  renderJob();
  renderDestination();
}
function renderDestination() {
  const sameProfile = state.handle && currentJob?.handle?.toLowerCase() === state.handle.toLowerCase() && (currentJob.platform || "x") === (state.platform || "x");
  const legacy = sameProfile && currentJob.pathVersion !== 2;
  const count = sameProfile && currentJob.folderCount > 0 ? ` (${currentJob.folderCount})` : legacy ? "" : " (số ảnh)";
  const base = legacy ? (state.platform === "facebook" ? "FacebookDownload" : "XDownload") : `WakuDownload / ${state.platform === "pixiv" ? "Pixiv" : state.platform === "facebook" ? "Facebook" : "X"}`;
  $("destination").textContent = `${base} / ${state.handle || "username"}${count}`;
  $("destination").title = sameProfile && currentJob.folderCount > 0 ? "Thư mục của lượt tải gần nhất" : "Số ảnh được thêm vào tên thư mục khi bắt đầu tải";
}
function renderJob() {
  $("job").hidden = !currentJob;
  if (!currentJob) return;
  const job = currentJob;
  const labels = { running: "Đang tải", paused: "Đã tạm dừng", complete: "Đã tải xong", cancelled: "Đã dừng tải", finished_with_errors: "Tải xong, có ảnh lỗi" };
  const label = job.status === "finished_with_errors" && !job.failed && job.sourceStatus === "failed" ? "Tải xong, lỗi file nguồn" : labels[job.status] || job.status;
  $("job-title").textContent = `${label} · ${job.platform === "pixiv" ? "Pixiv " : job.platform === "facebook" ? "FB " : "@"}${job.handle}`;
  $("job-count").textContent = `${job.done}/${job.total}`;
  $("progress").max = Math.max(1, job.total);
  $("progress").value = job.done + job.failed + job.cancelled;
  $("job-detail").textContent = [job.failed ? `${job.failed} ảnh lỗi: ${job.errors?.[0] || "Tải gián đoạn"}` : "", job.sourceStatus === "failed" ? `Lỗi #nguon.txt: ${job.sourceError}` : "", job.active ? `${job.active} đang tải${job.status === "paused" ? " nốt" : ""}` : "", job.queued ? `${job.queued} đang đợi` : "", job.waiting ? `${job.waiting} chờ tự thử lại` : "", job.skipped ? `Bỏ qua ${job.skipped} ảnh đã tải` : "", job.cancelled ? `${job.cancelled} ảnh chưa tải` : ""].filter(Boolean).join(" · ");
  $("job-detail").title = $("job-detail").textContent;
  $("pause").hidden = !["running", "paused"].includes(job.status);
  $("pause").textContent = job.status === "paused" ? "Tiếp tục" : "Tạm dừng";
  $("pause").title = job.status === "running" ? "Ảnh đang tải sẽ tiếp tục đến khi xong" : "Tiếp tục những ảnh đang chờ";
  $("cancel").hidden = !["running", "paused"].includes(job.status);
  $("retry").hidden = (!job.failed && job.sourceStatus !== "failed") || ["running", "paused"].includes(job.status);
}
function summarize(job) {
  if (!job) return null;
  const count = status => job.items.filter(item => item.status === status).length;
  return { handle: job.handle, platform: job.platform || "x", pathVersion: job.pathVersion || 1, folderCount: job.folderCount ?? null, status: job.status, total: job.items.length, done: count("complete"), failed: count("failed"), active: count("active") + count("preparing"), queued: count("queued"), waiting: count("waiting"), cancelled: count("cancelled"), skipped: job.skipped, sourceStatus: job.source?.status || null, sourceError: job.source?.error || "", errors: job.items.filter(item => item.status === "failed").slice(0, 3).map(item => item.error) };
}
async function startDownload(items) {
  if (busy.has("download")) return;
  busy.add("download"); updateProgress();
  try { currentJob = (await worker({ type: "DOWNLOAD", platform: state.platform, handle: state.handle, name: state.name, profileId: state.profileId, items, skipSaved: $("skip-saved").checked })).job; }
  catch (error) { showError(error); }
  finally { busy.delete("download"); updateProgress(); }
}
window.addEventListener("message", event => {
  if (event.source !== parent || event.origin !== parentOrigin || event.data?.type !== "WAKU_PANEL_STATE") return;
  const raw = event.data.state;
  const facebook = raw?.platform === "facebook";
  const pixiv = raw?.platform === "pixiv";
  const handle = pixiv ? WakuPixiv.handle(raw?.handle) : facebook ? WakuFacebook.handle(raw?.handle) : WakuX.profile(raw?.handle);
  const items = (Array.isArray(raw?.items) ? raw.items : []).slice(0, WakuX.LIMIT).map(item => pixiv ? WakuPixiv.normalize(item, handle) : facebook ? WakuFacebook.normalize(item, handle) : WakuX.normalize(item, handle)).filter(Boolean);
  const validIds = new Set(items.map(item => item.id));
  state = { ...raw, handle, items, selected: (Array.isArray(raw?.selected) ? raw.selected : []).filter(id => validIds.has(id)) };
  render();
});
$("avatar").addEventListener("error", () => { $("avatar").hidden = true; });
$("collapse").addEventListener("click", () => command("COLLAPSE"));
$("select-all").addEventListener("change", event => command("SELECT_ALL", { selected: event.target.checked }));
$("select-new").addEventListener("change", event => command("SELECT_NEW", { selected: event.target.checked }));
$("skip-saved").addEventListener("change", () => { void chromeCall(() => chrome.storage.local.set({ skipSaved: $("skip-saved").checked })).catch(showError); });
$("more").addEventListener("click", () => { visible += 60; render(); });
$("list").addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => command("SCROLL", { scrollTop: $("list").scrollTop }), 120);
}, { passive: true });
$("download").addEventListener("click", () => { const selected = new Set(state.selected); void startDownload(state.items.filter(item => selected.has(item.id))); });
$("pause").addEventListener("click", () => {
  const button = $("pause");
  button.disabled = true;
  void worker({ type: currentJob?.status === "paused" ? "RESUME_DOWNLOAD" : "PAUSE_DOWNLOAD" }).then(result => { currentJob = result.job; updateProgress(); }).catch(showError).finally(() => { button.disabled = false; });
});
$("cancel").addEventListener("click", () => { void worker({ type: "CANCEL_DOWNLOAD" }).then(result => { currentJob = result.job; updateProgress(); }).catch(showError); });
$("retry").addEventListener("click", () => { void worker({ type: "RETRY_DOWNLOAD" }).then(result => { currentJob = result.job; updateProgress(); }).catch(showError); });
$("open-folder").addEventListener("click", () => { void chromeCall(() => chrome.downloads.showDefaultFolder()).catch(showError); });
void chromeCall(() => chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.job) { currentJob = summarize(changes.job.newValue); updateProgress(); }
  if (changes.skipSaved) $("skip-saved").checked = changes.skipSaved.newValue !== false;
})).catch(showError);
void (async () => {
  try {
    const [settings, result] = await Promise.all([chromeCall(() => chrome.storage.local.get("skipSaved")), worker({ type: "JOB" })]);
    $("skip-saved").checked = settings.skipSaved !== false;
    currentJob = result.job;
    updateProgress();
  } catch (error) { showError(error); }
})();
if (parentOrigin) parent.postMessage({ type: "WAKU_PANEL_READY" }, parentOrigin);
