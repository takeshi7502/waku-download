import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, mkdir, readdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const extension = process.env.WAKU_EXTENSION_DIR || path.join(root, "extension");
const artifacts = path.join(root, "artifacts");
async function browserPath() {
  if (process.env.WAKU_CHROMIUM) return process.env.WAKU_CHROMIUM;
  try { await access(chromium.executablePath()); return chromium.executablePath(); } catch {}
  const cache = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright");
  if (cache) {
    const directories = (await readdir(cache).catch(() => [])).filter(name => /^chromium-\d+$/.test(name)).sort().reverse();
    for (const directory of directories) {
      const executable = path.join(cache, directory, "chrome-win64", "chrome.exe");
      try { await access(executable); return executable; } catch {}
    }
  }
  return chromium.executablePath();
}
const media = id => ({ type: "photo", media_url_https: `https://pbs.twimg.com/media/${id}.jpg` });
const tweet = (handle, id, photos) => ({ rest_id: id, core: { user_results: { result: { rest_id: handle === "example" ? "987654321" : "111", core: { screen_name: handle, name: handle } } } }, legacy: { full_text: `Ảnh của ${handle} — bài ${id}`, created_at: "2026-10-29T02:30:00Z", extended_entities: { media: photos.map(media) } } });
const responses = {
  initial: { data: { timeline: [tweet("example", "111", ["first", "second", "third", "fourth"]), tweet("other", "222", ["ignoreOther"])] } },
  scroll: { data: { timeline: [tweet("example", "333", ["afterScroll", "anotherPhoto"])] } },
  xhr: { data: { timeline: [tweet("example", "444", ["fromXHR"])] } },
  many: { data: { timeline: Array.from({ length: 25 }, (_, index) => tweet("example", String(1000 + index), [`batch${index}`])) } }
};
const html = `<!doctype html><html><head><meta charset="utf-8"><title>X fixture</title></head><body style="margin:0;background:#101719;color:white;height:7000px;font:14px system-ui"><main data-testid="primaryColumn" style="padding:40px 80px">
<h1 data-testid="UserName">Example</h1><p>@example · Ảnh và video</p>
<a href="/example/status/111/photo/1"><img width="100" src="https://pbs.twimg.com/media/first?format=jpg&name=small"></a>
<a href="/example/status/555/photo/1"><img width="100" src="https://pbs.twimg.com/media/domOnly.jpg"></a>
<a href="/other/status/222/photo/1"><img width="100" src="https://pbs.twimg.com/media/ignoreOther.jpg"></a>
<a href="/example/status/666"><div data-testid="videoPlayer"><img width="100" src="https://pbs.twimg.com/media/videoOnly.jpg"></div></a>
<img width="100" src="https://pbs.twimg.com/profile_images/avatar.jpg">
</main><script>
fetch('/i/api/graphql/fixture/UserMedia?batch=initial');
let sent = false;
addEventListener('scroll', () => { if (!sent) { sent = true; fetch('/i/api/graphql/fixture/UserMedia?batch=scroll'); } });
window.loadBatch = batch => fetch('/i/api/graphql/fixture/UserMedia?batch=' + batch);
window.loadXHR = () => { const request = new XMLHttpRequest(); request.open('GET', '/i/api/graphql/fixture/UserMedia?batch=xhr'); request.send(); };
</script></body></html>`;
async function waitFor(read, predicate, message) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  assert.fail(message);
}

test("launcher starts collapsed, snaps to an edge and remembers its position across sites", { timeout: 60000 }, async () => {
  const userData = await mkdtemp(path.join(tmpdir(), "waku-launcher-test-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(userData, { executablePath: await browserPath(), headless: true, viewport: { width: 1200, height: 800 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    for (const origin of ["https://x.com/**", "https://web.facebook.com/**", "https://www.pixiv.net/**"]) {
      await context.route(origin, route => route.fulfill({ contentType: "text/html", body: "<main><h1>Profile</h1></main>" }));
    }
    const page = await context.newPage();
    await page.goto("https://x.com/example/media");
    const button = page.locator("#waku-launcher");
    await button.waitFor({ state: "visible" });
    assert.equal(await page.locator("#waku-panel iframe").isVisible(), false);
    assert.equal(await button.locator("svg").count(), 1);
    let box = await button.boundingBox();
    assert.equal(box.width, 38);
    assert.equal(box.x + box.width, 1196);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(200, 230, { steps: 8 });
    await page.mouse.up();
    box = await button.boundingBox();
    assert.equal(box.x, 4, "dragging left must snap to the left edge");
    assert.equal(await button.isVisible(), true, "dragging must not open the panel");
    assert.ok(box.y > 150 && box.y < 250);
    const savedTop = box.y;
    await waitFor(() => worker.evaluate(() => chrome.storage.local.get("launcherPosition")), value => value.launcherPosition?.side === "left", "launcher position should be saved");
    await button.click();
    await page.frameLocator("#waku-panel iframe").locator("header").waitFor();
    assert.equal((await page.locator("#waku-panel").boundingBox()).x, 12, "expanded panel should follow the launcher side");
    await page.reload();
    await button.waitFor({ state: "visible" });
    box = await button.boundingBox();
    assert.equal(box.x, 4);
    assert.equal(box.y, savedTop);
    for (const url of ["https://web.facebook.com/profile.php?id=42&sk=photos", "https://www.pixiv.net/en/users/42"]) {
      const tab = await context.newPage(); await tab.goto(url);
      const icon = tab.locator("#waku-launcher"); await icon.waitFor({ state: "visible" });
      assert.equal((await icon.boundingBox()).x, 4);
      assert.equal(await tab.locator("#waku-panel iframe").isVisible(), false);
      await tab.close();
    }
    await page.bringToFront();
    box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(950, 300, { steps: 8 }); await page.mouse.up();
    box = await button.boundingBox();
    assert.equal(box.x + box.width, 1196, "dragging right must snap to the right edge");
    assert.equal(await button.isVisible(), true);
  } finally {
    await context?.close();
    const expected = path.resolve(tmpdir()) + path.sep;
    if (path.resolve(userData).startsWith(expected) && path.basename(userData).startsWith("waku-launcher-test-")) await rm(userData, { recursive: true, force: true });
  }
});

test("docked panel: passive capture, collapse, tab switching, persisted selection and fixed download progress", { timeout: 90000 }, async () => {
  const userData = await mkdtemp(path.join(tmpdir(), "waku-test-"));
  let context;
  const errors = [];
  try {
    context = await chromium.launchPersistentContext(userData, { executablePath: await browserPath(), headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).hostname;
    const manager = await context.newPage();
    await manager.goto("chrome://extensions/");
    await manager.evaluate(async extensionId => {
      await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
      await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, errorCollection: true });
      globalThis.extensionErrorEvents = [];
      chrome.developerPrivate.onItemStateChanged.addListener(event => {
        if (event.item_id === extensionId && event.extensionInfo?.runtimeErrors?.length) {
          extensionErrorEvents.push(...event.extensionInfo.runtimeErrors);
        }
      });
    }, extensionId);
    const chromeErrors = () => manager.evaluate(extensionId => new Promise(resolve => {
      chrome.developerPrivate.getExtensionInfo(extensionId, info => {
        const error = chrome.runtime.lastError;
        resolve({ errors: info?.runtimeErrors || [], events: globalThis.extensionErrorEvents, lookupError: error?.message });
      });
    }), extensionId);
    assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().action.default_popup), undefined);
    await context.route("https://x.com/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes("/graphql/")) return route.fulfill({ json: responses[url.searchParams.get("batch")] || responses.initial });
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    });
    await context.route("https://pbs.twimg.com/**", route => {
      const label = new URL(route.request().url()).pathname.split("/").pop();
      const colors = ["#d8c7e4", "#bbd4e1", "#e2ceb5", "#c3d7d0"];
      const color = colors[label.length % colors.length];
      return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="130"><rect width="100" height="130" fill="${color}"/><circle cx="50" cy="43" r="19" fill="#ffffff80"/><path d="M15 130V99a35 35 0 0 1 70 0v31" fill="#ffffff80"/></svg>` });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://x.com/example/media");
    await page.bringToFront();
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
    const send = message => worker.evaluate(({ tabId, message }) => chrome.tabs.sendMessage(tabId, message), { tabId, message });
    const status = () => send({ type: "STATUS" });
    let state = await waitFor(status, value => value.items.length === 5 && !value.restoring, "initial photos should be captured without pressing a collect button");
    assert.ok(!state.items.some(item => item.id === "videoOnly" || item.id === "ignoreOther"));
    assert.equal(state.profileId, "987654321");
    assert.equal(await page.evaluate(() => scrollY), 0, "extension must not scroll the page automatically");
    await worker.evaluate(() => chrome.storage.local.set({ panelEnabled: true }));
    await send({ type: "OPEN_PANEL" });
    let panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({ hasText: "5 ảnh" }).waitFor();
    assert.equal(await page.locator("#waku-panel").getAttribute("data-waku-version"), "1.2.2");
    assert.equal(await panel.locator(".photo").count(), 5);
    await panel.getByLabel("Chọn ảnh second", { exact: true }).uncheck();
    await waitFor(status, value => value.selected.length === 4, "selection should update in the content state");
    await page.locator("h1").click();
    assert.equal(await panel.locator("header").isVisible(), true, "clicking outside must not dismiss the panel");

    const firstImage = await panel.locator(".photo img").first().elementHandle();
    await panel.locator("#collapse").click();
    await page.locator("#waku-launcher").waitFor({ state: "visible" });
    const launcherBox = await page.locator("#waku-launcher").boundingBox();
    assert.equal(launcherBox.y, 16, "collapsed launcher must be at the top of the viewport");
    assert.equal(launcherBox.x + launcherBox.width, 1440 - 4, "collapsed launcher must stay at the right edge");
    await page.evaluate(() => scrollTo(0, 800));
    await waitFor(status, value => value.items.length === 7, "manual scrolling should capture all newly loaded photos while collapsed");
    await page.locator("#waku-launcher").click();
    await panel.locator("#image-count").filter({ hasText: "7 ảnh" }).waitFor();
    assert.equal(await firstImage.evaluate(element => element.isConnected), true, "previews must not be recreated after collapse or new media");
    await page.evaluate(() => window.loadXHR());
    await waitFor(status, value => value.items.length === 8, "XHR media should also update automatically");
    await page.evaluate(() => {
      const main = document.querySelector("main");
      const link = document.createElement("a"); link.href = "/example/status/777/photo/1";
      const image = document.createElement("img"); image.src = "https://pbs.twimg.com/media/domLater.jpg";
      link.append(image); main.append(link);
    });
    await waitFor(status, value => value.items.length === 9, "DOM-only images should be observed automatically");
    await page.evaluate(() => window.loadBatch("many"));
    await waitFor(status, value => value.items.length === 34, "new API pages should be merged without duplicate photos");
    await panel.locator("#image-count").filter({ hasText: "34 ảnh" }).waitFor();
    await panel.locator("#list").evaluate(element => { element.scrollTop = 350; });
    await waitFor(status, value => value.scrollTop >= 340, "list scroll position must be remembered");

    // Hold browser downloads in progress to verify real iframe -> worker messaging and UI persistence.
    await worker.evaluate(() => {
      globalThis.testDownloads = new Map(); globalThis.downloadSettings = [];
      let id = 500;
      chrome.downloads.download = async settings => { downloadSettings.push(settings); const next = ++id; testDownloads.set(next, { id: next, state: "in_progress", url: settings.url }); return next; };
      chrome.downloads.search = async query => testDownloads.has(query.id) ? [testDownloads.get(query.id)] : [];
      chrome.downloads.cancel = async id => { testDownloads.get(id).state = "interrupted"; };
    });
    await panel.locator("#rows").evaluate(element => {
      globalThis.progressRowMutations = 0;
      new MutationObserver(records => { globalThis.progressRowMutations += records.length; }).observe(element, { childList: true, characterData: true, subtree: true });
    });
    await panel.locator("#download").click();
    await panel.locator("#job-title").filter({ hasText: "Đang tải" }).waitFor();
    assert.equal(await panel.locator("#job-count").textContent(), "0/33");
    const source = await worker.evaluate(() => downloadSettings.find(item => item.filename.endsWith("/#nguon.txt")));
    assert.equal(source.filename, "WakuDownload/X/example (33)/#nguon.txt");
    assert.match(decodeURIComponent(source.url.split(",")[1]), /https:\/\/x\.com\/i\/user\/987654321/);
    assert.equal(await panel.locator("#destination").textContent(), "WakuDownload / X / example (33)");
    assert.equal(await panel.locator("#rows").evaluate(() => globalThis.progressRowMutations), 0, "progress updates must not rebuild row text or previews");
    const footerBefore = await panel.locator("footer").boundingBox();
    await panel.locator("#list").evaluate(element => { element.scrollTop = 700; });
    const footerAfter = await panel.locator("footer").boundingBox();
    assert.equal(footerBefore.y, footerAfter.y, "progress and download controls must remain fixed while the list scrolls");
    assert.ok(footerAfter.y + footerAfter.height <= 900);
    const other = await context.newPage();
    await other.goto("https://x.com/other/media");
    const otherPanel = other.frameLocator("#waku-panel iframe");
    await other.locator("#waku-launcher").click();
    await otherPanel.locator("#job-title").filter({ hasText: "Đang tải" }).waitFor();
    await page.bringToFront();
    assert.equal(await panel.locator("#job-count").textContent(), "0/33");
    assert.equal(await panel.getByLabel("Chọn ảnh second", { exact: true }).isChecked(), false);
    assert.equal(await firstImage.evaluate(element => element.isConnected), true, "tab switching must preserve existing previews");
    await page.waitForTimeout(500);
    await page.reload();
    panel = page.frameLocator("#waku-panel iframe");
    await page.locator("#waku-launcher").click();
    await panel.locator("#image-count").filter({ hasText: "34 ảnh" }).waitFor();
    await panel.locator("#job-title").filter({ hasText: "Đang tải" }).waitFor();
    assert.equal(await panel.getByLabel("Chọn ảnh second", { exact: true }).isChecked(), false, "reload should restore deselected images");
    assert.ok(await panel.locator("#list").evaluate(element => element.scrollTop) >= 600, "reload should restore the list scroll position");

    await page.evaluate(() => history.pushState({}, "", "/other/media"));
    await waitFor(status, value => value.handle === "other" && !value.restoring, "profile navigation should switch collections");
    await page.evaluate(() => history.pushState({}, "", "/example/media"));
    state = await waitFor(status, value => value.handle === "example" && value.items.length === 34, "returning to a profile should restore its own collection");
    assert.equal(state.selected.includes("second"), false);
    await panel.locator("#image-count").filter({ hasText: "34 ảnh" }).waitFor();
    await panel.locator("#cancel").click();
    await panel.locator("#job-title").filter({ hasText: "Đã dừng tải" }).waitFor();
    await panel.locator("#list").evaluate(element => { element.scrollTop = 0; });
    await mkdir(artifacts, { recursive: true });
    await page.locator("#waku-panel").screenshot({ path: path.join(artifacts, "panel.png") });
    await page.setViewportSize({ width: 1280, height: 450 });
    const compact = await panel.locator("footer").boundingBox();
    assert.ok(compact.y >= 16 && compact.y + compact.height <= 435, "footer must remain visible in a short browser window");
    await panel.locator("#collapse").click();
    await page.locator("#waku-launcher").waitFor({ state: "visible" });
    await page.waitForTimeout(350);
    await page.reload();
    await page.locator("#waku-launcher").waitFor({ state: "visible" });
    assert.equal((await status()).items.length, 34, "collapsed panel should continue to preserve its collection");
    assert.equal((await page.locator("#waku-launcher").boundingBox()).y, 16, "restored launcher must also remain in the upper corner");

    // Reproduce the reported failure: reload the actual extension while its old
    // content script stays alive on an existing X tab, then trigger more activity.
    // Return the evaluation before the worker destroys its own execution context.
    const beforeReload = await chromeErrors();
    assert.deepEqual(beforeReload.errors, [], "Chrome's own extension error log must be empty before reload");
    await manager.evaluate(extensionId => chrome.developerPrivate.reload(extensionId, { failQuietly: true }), extensionId);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("scroll"));
      document.querySelector("main").append(document.createElement("div"));
      window.loadXHR();
    });
    await waitFor(() => page.locator("#waku-launcher").getAttribute("title"), title => title?.includes("đã cập nhật"), "old content script should retire cleanly when the extension is reloaded");
    assert.equal(await page.locator("#waku-panel iframe").count(), 0, "retired extension frame must be removed");
    await page.waitForTimeout(1100);
    const afterReload = await chromeErrors();
    assert.deepEqual(afterReload.errors, [], "Chrome's own extension error log must be empty after reload");
    assert.deepEqual(afterReload.events, [], "Chrome must not report new extension errors while retiring old scripts");
    await Promise.all([page.waitForEvent("load"), page.locator("#waku-launcher").click()]);
    // runtime.reload unloads the command-line test extension. The recovery
    // button must still reload the page without using any extension API.
    assert.equal(page.url(), "https://x.com/example/media");
    assert.equal(await page.locator("#waku-launcher").filter({ hasText: "↻" }).count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    const expected = path.resolve(tmpdir()) + path.sep;
    if (path.resolve(userData).startsWith(expected) && path.basename(userData).startsWith("waku-test-")) await rm(userData, { recursive: true, force: true });
  }
});
