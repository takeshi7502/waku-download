import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, readdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const extension = fileURLToPath(new URL("../extension", import.meta.url));
async function executable() {
  if (process.env.WAKU_CHROMIUM) return process.env.WAKU_CHROMIUM;
  try { await access(chromium.executablePath()); return chromium.executablePath(); } catch {}
  const root = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright");
  if (root) for (const dir of (await readdir(root).catch(() => [])).filter(x => /^chromium-\d+$/.test(x)).sort().reverse()) { const exe = path.join(root, dir, "chrome-win64", "chrome.exe"); try { await access(exe); return exe; } catch {} }
  return chromium.executablePath();
}
const xvideo = "https://video.twimg.com/ext_tw_video/44/pu/vid/1280x720/a.mp4?tag=12";
const fbvideo = "https://video.xx.fbcdn.net/v/t42/a.mp4?sig=signed";
const tweet = { rest_id: "101", core: { user_results: { result: { core: { screen_name: "artist" } } } }, legacy: { full_text: "mixed", extended_entities: { media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/photo.jpg" }, { type: "video", id_str: "44", media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/44/pu/img/a.jpg", video_info: { variants: [{ content_type: "video/mp4", bitrate: 1000, url: xvideo }] } }] } } };
const fb = { __typename: "Video", id: "123", owner: { url: "https://www.facebook.com/artist", name: "Artist" }, playable_url_quality_hd: fbvideo };
test("X resolves a visible video when timeline data omits the video", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-video-fallback-")); let context;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await executable(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await context.route("https://x.com/**", route => route.fulfill({ contentType: "text/html", body: `<main data-testid="primaryColumn"><h1 data-testid="UserName">artist</h1><a href="/artist/status/1631692306506973185/video/1"><img src="https://pbs.twimg.com/ext_tw_video_thumb/44/pu/img/a.jpg"></a></main>` }));
    await context.route("https://cdn.syndication.twimg.com/**", route => route.fulfill({ json: { id_str: "1631692306506973185", user: { screen_name: "artist" }, mediaDetails: [{ type: "video", media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/44/pu/img/a.jpg", video_info: { variants: [{ content_type: "video/mp4", bitrate: 1000, url: xvideo }] } }] } }));
    const page = await context.newPage(); await page.goto("https://x.com/artist/media");
    await page.locator("#waku-launcher").click(); const panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({ hasText: "1 video" }).waitFor();
    assert.equal(await panel.locator("#type-video").isChecked(), true);
  } finally { await context?.close(); if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-video-fallback-")) await rm(dir, { recursive: true, force: true }); }
});
test("X falls back to FxTwitter for a video unavailable through syndication", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-video-fx-")); let context;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await executable(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await context.route("https://x.com/**", route => route.fulfill({ contentType: "text/html", body: `<main data-testid="primaryColumn"><h1 data-testid="UserName">artist</h1><a href="/artist/status/10/video/1"><img src="https://pbs.twimg.com/amplify_video_thumb/44/a.jpg"></a></main>` }));
    await context.route("https://cdn.syndication.twimg.com/**", route => route.fulfill({ json: { __typename: "TweetTombstone", tombstone: {} } }));
    await context.route("https://api.fxtwitter.com/**", route => route.fulfill({ json: { tweet: { id: "10", author: { screen_name: "artist" }, media: { all: [{ id: "44", type: "video", thumbnail_url: "https://pbs.twimg.com/amplify_video_thumb/44/a.jpg", variants: [{ content_type: "video/mp4", bitrate: 1000, url: xvideo }] }] } } } }));
    const page = await context.newPage(); await page.goto("https://x.com/artist/media");
    await page.locator("#waku-launcher").click(); const panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({ hasText: "1 video" }).waitFor();
    assert.equal(await panel.locator("#type-video").isChecked(), true);
  } finally { await context?.close(); if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-video-fx-")) await rm(dir, { recursive: true, force: true }); }
});
test("X and Facebook expose media filters and enqueue only selected video", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-video-")); let context;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await executable(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await context.route("https://x.com/**", route => route.request().url().includes("/graphql/") ? route.fulfill({ json: { data: [tweet] } }) : route.fulfill({ contentType: "text/html", body: `<main><h1 data-testid="UserName">artist</h1></main><script>fetch('/i/api/graphql/a/UserMedia')</script>` }));
    await context.route("https://web.facebook.com/**", route => route.fulfill({ contentType: "text/html", body: `<script type="application/json">${JSON.stringify(fb)}</script><main role="main"><a href="/artist/videos/123/">video</a></main>` }));
    await context.route("https://pbs.twimg.com/**", route => route.fulfill({ status: 404 }));
    const page = await context.newPage(); await page.goto("https://x.com/artist/media");
    await page.locator("#waku-launcher").click(); const panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({ hasText: "1 ảnh · 1 video" }).waitFor();
    assert.equal(await panel.locator("#type-photo").isChecked(), true); assert.equal(await panel.locator("#type-video").isChecked(), true);
    await page.evaluate(() => history.pushState({}, "", "?filter=video"));
    await panel.locator("#image-count").filter({ hasText: /^1 video$/ }).waitFor();
    assert.equal(await panel.locator("#type-photo").isChecked(), false);
    await page.evaluate(() => history.pushState({}, "", "/artist/media"));
    await panel.locator("#image-count").filter({ hasText: "1 ảnh · 1 video" }).waitFor();
    await panel.locator("#type-photo").uncheck();
    assert.equal(await panel.locator("#image-count").textContent(), "1 video");
    await worker.evaluate(() => { globalThis.videoDownloads = []; let id = 0; chrome.downloads.download = async x => { videoDownloads.push(x); return ++id; }; chrome.downloads.search = async () => [{ state: "in_progress" }]; chrome.downloads.cancel = async () => {}; });
    await panel.locator("#type-photo").check();
    await panel.locator("#download").click(); await panel.locator("#job-count").filter({ hasText: "0/2" }).waitFor();
    assert.equal((await worker.evaluate(() => videoDownloads.filter(x => !x.url.startsWith("data:")))).length, 2);
    await panel.locator("#cancel").click();
    await panel.locator("#type-photo").uncheck();
    await panel.locator("#download").click(); await panel.locator("#job-count").filter({ hasText: "0/1" }).waitFor();
    assert.equal((await worker.evaluate(() => videoDownloads.find(x => x.url.includes("video.twimg.com")))).url, xvideo);
    await panel.locator("#cancel").click();
    const page2 = await context.newPage(); await page2.goto("https://web.facebook.com/artist/videos");
    await page2.locator("#waku-launcher").click(); const fbpanel = page2.frameLocator("#waku-panel iframe");
    await fbpanel.locator("#image-count").filter({ hasText: "1 video" }).waitFor();
    assert.equal(await fbpanel.locator("#type-photo").isChecked(), false);
    assert.equal(await fbpanel.locator("#type-video").isChecked(), true);
    await fbpanel.locator("#download").click(); await fbpanel.locator("#job-count").filter({ hasText: "0/1" }).waitFor();
    const saved = await worker.evaluate(() => videoDownloads.find(x => x.url.includes("fbcdn.net")));
    assert.equal(saved.url, fbvideo); assert.match(saved.filename, /Facebook\/artist \(1\)\/123\.mp4$/);
    const direct = await context.newPage(); await direct.goto("https://web.facebook.com/watch/?v=123");
    await direct.locator("#waku-launcher").click(); const directPanel = direct.frameLocator("#waku-panel iframe");
    await directPanel.locator("#image-count").filter({ hasText: "1 video" }).waitFor();
    assert.equal(await directPanel.locator("#profile-name").textContent(), "Artist");
  } finally { await context?.close(); if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-video-")) await rm(dir, { recursive: true, force: true }); }
});
