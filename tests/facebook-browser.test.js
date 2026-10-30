import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, readdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extension = process.env.WAKU_EXTENSION_DIR || fileURLToPath(new URL("../extension", import.meta.url));
async function browserPath() {
  if (process.env.WAKU_CHROMIUM) return process.env.WAKU_CHROMIUM;
  try { await access(chromium.executablePath()); return chromium.executablePath(); } catch {}
  const cache = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright");
  if (cache) for (const directory of (await readdir(cache).catch(() => [])).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
    const executable = path.join(cache, directory, "chrome-win64", "chrome.exe");
    try { await access(executable); return executable; } catch {}
  }
  return chromium.executablePath();
}
const profileUrl = "https://web.facebook.com/profile.php?id=100075970176818&sk=photos";
const small = id => `https://scontent.xx.fbcdn.net/v/t39/thumb${id}.jpg?stp=small&oh=thumb${id}`;
const large = id => `https://scontent.xx.fbcdn.net/v/t39/photo${id}.jpg?stp=large&oh=signed%2B${id}&oe=abcdef`;
const graphPhoto = id => ({ __typename: "Photo", id, photo_image: { uri: large(id), width: 1200, height: 1800 }, thumbnail: { uri: small(id), width: 100, height: 150 } });
const html = `<!doctype html><html><head><meta charset="utf-8"><script type="application/json">${JSON.stringify({ data: { initial: graphPhoto("501") } })}</script></head><body style="height:7000px;background:#17191c;color:white"><div role="main"><h1>火只木夏</h1><div id="grid"><a href="/photo/?fbid=501&amp;set=a.1"><img alt="Ảnh đầu" src="${small(501).replaceAll("&", "&amp;")}"></a></div><a href="/photo/?fbid=998"><video></video><img src="${small(998).replaceAll("&", "&amp;")}"></a><img src="${small(999).replaceAll("&", "&amp;")}"></div><script>
fetch('/api/graphql/?batch=initial');
let loaded = false;
addEventListener('scroll', () => { if (loaded) return; loaded = true;
  const link = document.createElement('a'); link.href='/photo.php?fbid=502&set=a.1';
  const image = document.createElement('img'); image.src=${JSON.stringify(small(502))}; image.alt='Ảnh thứ hai'; link.append(image); document.querySelector('#grid').append(link);
  fetch('/api/graphql/?batch=scroll');
});
</script></body></html>`;
async function waitFor(read, predicate, message) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 80)); }
  assert.fail(message);
}

test("Facebook profile photos: passive capture, signed full-size URL, selection and queue", { timeout: 60000 }, async () => {
  const userData = await mkdtemp(path.join(tmpdir(), "waku-fb-test-"));
  let context;
  const errors = [];
  try {
    context = await chromium.launchPersistentContext(userData, { executablePath: await browserPath(), headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await context.route("https://web.facebook.com/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/graphql")) {
        const photoNodes = url.searchParams.get("batch") === "scroll" ? [graphPhoto("502")] : [graphPhoto("503")];
        return route.fulfill({ contentType: "text/plain", body: `for (;;);\n${JSON.stringify({ data: { profile: { photos: photoNodes } } })}\n${JSON.stringify({ extensions: { done: true } })}` });
      }
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    });
    await context.route("https://scontent.xx.fbcdn.net/**", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(profileUrl);
    await page.bringToFront();
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
    const send = message => worker.evaluate(({ tabId, message }) => chrome.tabs.sendMessage(tabId, message), { tabId, message });
    const status = () => send({ type: "STATUS" });
    let state = await waitFor(status, value => value.items.length === 1 && value.items[0].url === large(501), "Facebook should find the visible photo and use the larger signed URL in embedded initial data");
    assert.equal(state.platform, "facebook");
    assert.equal(state.handle, "100075970176818");
    assert.equal(state.items[0].id, "501");
    assert.ok(!state.items.some(item => item.id === "503" || item.id === "998" || item.id === "999"), "unseen photos, videos and unrelated images must not enter the collection");
    await worker.evaluate(() => chrome.storage.local.set({ panelEnabled: true }));
    await send({ type: "OPEN_PANEL" });
    let panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({ hasText: "1 ảnh" }).waitFor();
    assert.equal(await panel.locator("#profile-name").textContent(), "火只木夏");
    assert.equal(await panel.locator("#post-count").textContent(), "Facebook");
    assert.equal(await panel.locator(".post-title a").first().getAttribute("href"), "https://www.facebook.com/photo/?fbid=501");
    await panel.getByLabel("Chọn ảnh 501", { exact: true }).uncheck();
    await waitFor(status, value => value.selected.length === 0, "deselection must update the Facebook collection");
    await panel.locator("#collapse").click();
    await page.evaluate(() => scrollTo(0, 800));
    state = await waitFor(status, value => value.items.length === 2 && value.items.some(item => item.id === "502" && item.url === large(502)), "scroll should add and upgrade the second photo while collapsed");
    assert.deepEqual(state.selected, ["502"]);
    await page.locator("#waku-launcher").click();
    await panel.locator("#image-count").filter({ hasText: "2 ảnh" }).waitFor();
    assert.equal(await panel.locator("#destination").textContent(), "WakuDownload / Facebook / 100075970176818 (số ảnh)");

    await worker.evaluate(() => {
      globalThis.testDownloads = new Map(); globalThis.downloadSettings = [];
      let id = 900;
      chrome.downloads.download = async settings => { downloadSettings.push(settings); const next = ++id; testDownloads.set(next, { id: next, state: "in_progress", url: settings.url }); return next; };
      chrome.downloads.search = async query => testDownloads.has(query.id) ? [testDownloads.get(query.id)] : [];
      chrome.downloads.cancel = async id => { testDownloads.get(id).state = "interrupted"; };
    });
    await panel.locator("#download").click();
    await panel.locator("#job-count").filter({ hasText: "0/1" }).waitFor();
    assert.equal(await panel.locator("#destination").textContent(), "WakuDownload / Facebook / 100075970176818 (1)");
    const settings = await worker.evaluate(() => downloadSettings[0]);
    assert.equal(settings.url, large(502), "signed URL must reach Chrome unchanged");
    assert.equal(settings.filename, "WakuDownload/Facebook/100075970176818 (1)/502.jpg");
    const source = await worker.evaluate(() => downloadSettings.find(item => item.filename.endsWith("/#nguon.txt")));
    assert.equal(source.filename, "WakuDownload/Facebook/100075970176818 (1)/#nguon.txt");
    assert.match(decodeURIComponent(source.url.split(",")[1]), /Tên: 火只木夏/);
    assert.match(decodeURIComponent(source.url.split(",")[1]), /facebook\.com\/profile\.php\?id=100075970176818/);
    await page.waitForTimeout(500);
    await page.reload();
    panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({ hasText: "2 ảnh" }).waitFor();
    await panel.locator("#job-count").filter({ hasText: "0/1" }).waitFor();
    assert.equal(await panel.getByLabel("Chọn ảnh 501", { exact: true }).isChecked(), false);
    await panel.locator("#cancel").click();
    await panel.locator("#job-title").filter({ hasText: "Đã dừng tải" }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    const expected = path.resolve(tmpdir()) + path.sep;
    if (path.resolve(userData).startsWith(expected) && path.basename(userData).startsWith("waku-fb-test-")) await rm(userData, { recursive: true, force: true });
  }
});
