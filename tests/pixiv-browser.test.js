import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, readdir, access, rm, readFile } from "node:fs/promises";
import https from "node:https";
import { zipSync } from "fflate";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const extension = fileURLToPath(new URL("../extension", import.meta.url));
async function browserPath() {
  if (process.env.WAKU_CHROMIUM) return process.env.WAKU_CHROMIUM;
  try { await access(chromium.executablePath()); return chromium.executablePath(); } catch {}
  const cache = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright");
  if (cache) for (const dir of (await readdir(cache).catch(() => [])).filter(x => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const exe = path.join(cache, dir, "chrome-win64", "chrome.exe"); try { await access(exe); return exe; } catch {}
  }
  return chromium.executablePath();
}
async function waitFor(read, predicate) { for (let i = 0; i < 100; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(r => setTimeout(r, 100)); } assert.fail("Timed out waiting for Pixiv"); }
const original = (id, page, ext = "png") => `https://i.pximg.net/img-original/img/2024/01/02/03/04/05/${id}_p${page}.${ext}`;
test("Pixiv identifies Ugoira on a direct artwork page", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-pixiv-animation-")); let context;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await browserPath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await context.route("https://www.pixiv.net/**", route => {
      const u = new URL(route.request().url());
      if (u.pathname === "/ajax/illust/789") return route.fulfill({ json: { error: false, body: { userId: "42", userName: "Artist", title: "Animation", illustType: 2 } } });
      if (u.pathname === "/ajax/illust/789/ugoira_meta") return route.fulfill({ json: { error: false, body: { originalSrc: "https://i.pximg.net/img-zip-ugoira/img/2024/01/02/03/04/05/789_ugoira1920x1080.zip", frames: [{ file: "000000.jpg", delay: 100 }] } } });
      return route.fulfill({ contentType: "text/html", body: "<main><h1>Animation</h1></main>" });
    });
    const page = await context.newPage(); await page.goto("https://www.pixiv.net/en/artworks/789");
    await page.locator("#waku-launcher").click(); const panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({hasText:"1 video"}).waitFor();
    assert.equal(await panel.locator("#type-photo").isChecked(), false);
    assert.equal(await panel.locator("#type-video").isChecked(), true);
    assert.equal(await panel.getByLabel("Chọn video 789_ugoira").count(), 1);
  } finally { await context?.close(); if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-pixiv-animation-")) await rm(dir, { recursive: true, force: true }); }
});
test("Pixiv can recover Ugoira from the page's authenticated API responses", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-pixiv-bridge-")); let context; let metadataRequests = 0;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await browserPath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await context.route("https://www.pixiv.net/**", route => {
      const u = new URL(route.request().url());
      if (u.pathname === "/ajax/illust/135343815") return route.fulfill({ json: { error: false, body: { userId: "117551844", userName: "Artist", title: "Animation", illustType: 2, xRestrict: 1 } } });
      if (u.pathname === "/ajax/illust/135343815/ugoira_meta") {
        metadataRequests++;
        return metadataRequests === 1 ? route.fulfill({ status: 404, json: { error: true } }) : route.fulfill({ json: { error: false, body: { originalSrc: "https://i.pximg.net/img-zip-ugoira/img/2024/01/02/03/04/05/135343815_ugoira1920x1080.zip", frames: [{ file: "000000.jpg", delay: 100 }] } } });
      }
      return route.fulfill({ contentType: "text/html", body: `<main><h1>Animation</h1></main><script>setTimeout(async()=>{await fetch('/ajax/illust/135343815');await fetch('/ajax/illust/135343815/ugoira_meta')},1500)</script>` });
    });
    const page = await context.newPage(); await page.goto("https://www.pixiv.net/en/artworks/135343815");
    await page.locator("#waku-launcher").click(); const panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({ hasText: "1 video" }).waitFor();
    assert.ok(metadataRequests >= 2);
    assert.equal(await panel.locator("#type-video").isChecked(), true);
  } finally { await context?.close(); if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-pixiv-bridge-")) await rm(dir, { recursive: true, force: true }); }
});
test("Pixiv collects original pages, validates authors, persists and downloads", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-pixiv-")); let context;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await browserPath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const rules = await worker.evaluate(() => chrome.declarativeNetRequest.testMatchOutcome({ url: "https://i.pximg.net/img-original/img/2024/01/02/03/04/05/123_p0.png", type: "other", initiator: chrome.runtime.getURL("") }));
    assert.ok(rules.matchedRules.some(rule => rule.ruleId === 1), "Pixiv original downloads need the Referer rule");
    await context.route("https://www.pixiv.net/**", route => {
      const u = new URL(route.request().url()), match = u.pathname.match(/^\/ajax\/illust\/(\d+)(\/pages)?$/);
      if (match) {
        const id = match[1];
        return route.fulfill({ json: { error: false, body: match[2] ? [0,1].map(p => ({ urls: { original: original(id,p), small: `https://i.pximg.net/img-master/${id}_p${p}.jpg` } })) : { userId: id === "999" ? "99" : "42", userName: "Pixiv Artist", title: `Work ${id}`, illustType: 0 } } });
      }
      return route.fulfill({ contentType: "text/html", body: `<main><h1>Pixiv Artist</h1><a href="/artworks/123"><img src="https://i.pximg.net/img-master/123_p0.jpg"></a><a href="/artworks/999">Other</a><div id="later"></div></main><script>addEventListener('scroll',()=>{document.querySelector('#later').innerHTML='<a href="/artworks/456">Next</a>'},{once:true})</script><style>body{height:4000px}</style>` });
    });
    await context.route("https://i.pximg.net/**", route => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
    const page = await context.newPage(); await page.goto("https://www.pixiv.net/en/users/42/artworks"); await page.bringToFront();
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
    const send = message => worker.evaluate(({tabId,message}) => chrome.tabs.sendMessage(tabId,message),{tabId,message});
    let state = await waitFor(() => send({type:"STATUS"}), s => s.items.length === 2);
    assert.equal(state.platform, "pixiv"); assert.deepEqual(state.items.map(x => x.url), [original("123",0),original("123",1)]);
    await send({type:"OPEN_PANEL"}); const panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({hasText:"2 ảnh"}).waitFor();
    await page.evaluate(() => scrollTo(0, 900));
    state = await waitFor(() => send({type:"STATUS"}), s => s.items.length === 4);
    assert.ok(!state.items.some(x => x.tweetId === "999"));
    await page.evaluate(() => history.pushState({}, "", "/en/artworks/123"));
    state = await waitFor(() => send({type:"STATUS"}), s => s.handle === "42" && s.items.length === 2 && s.items.every(x => x.tweetId === "123"));
    await page.evaluate(() => history.pushState({}, "", "/en/artworks/999"));
    state = await waitFor(() => send({type:"STATUS"}), s => s.handle === "99" && s.items.length === 2 && s.items.every(x => x.tweetId === "999"));
    await page.evaluate(() => history.pushState({}, "", "/en/users/42/artworks"));
    state = await waitFor(() => send({type:"STATUS"}), s => s.handle === "42" && s.items.length === 4);
    await worker.evaluate(() => { globalThis.settings = []; pixivBlob = async url => url; chrome.downloads.download = async s => { settings.push(s); return settings.length; }; chrome.downloads.search = async () => [{state:"in_progress"}]; });
    await panel.locator("#download").click();
    await panel.locator("#job-count").filter({hasText:"0/4"}).waitFor();
    const calls = await waitFor(() => worker.evaluate(() => settings), values => values.some(value => value.url === original("123", 0)));
    const photo = calls.find(value => value.url === original("123", 0));
    assert.equal(photo.filename, "WakuDownload/Pixiv/42 (4)/123_p0.png");
    const source = calls.find(x => x.filename.endsWith("/#nguon.txt"));
    assert.match(decodeURIComponent(source.url), /https:\/\/www.pixiv.net\/users\/42/);
    await page.waitForTimeout(500); await page.reload();
    state = await waitFor(() => send({type:"STATUS"}), s => s.items.length === 4);
    assert.equal(state.selected.length, 4);
    const direct = await context.newPage(); await direct.goto("https://www.pixiv.net/en/artworks/123"); await direct.bringToFront();
    const directTab = await worker.evaluate(async () => (await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
    const directState = await waitFor(() => worker.evaluate(id => chrome.tabs.sendMessage(id, {type:"STATUS"}), directTab), s => s.handle === "42" && s.items.length === 2);
    assert.deepEqual(directState.items.map(x => x.url), [original("123",0), original("123",1)]);
  } finally { await context?.close(); if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-pixiv-")) await rm(dir,{recursive:true,force:true}); }
});

test("Chromium sends the required Referer on an actual Pixiv download", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-pixiv-download-"));
  const key = await readFile(new URL("./fixtures/localhost-key.pem", import.meta.url));
  const cert = await readFile(new URL("./fixtures/localhost-cert.pem", import.meta.url));
  let headers;
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const server = https.createServer({ key, cert }, (req, res) => {
    headers = req.headers;
    if (req.headers.referer !== "https://www.pixiv.net/") { res.writeHead(403, { "Content-Type": "text/html" }); res.end("Forbidden"); return; }
    res.writeHead(200, { "Content-Type": "image/png" }); res.end(imageBytes);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await browserPath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-proxy-server", "--ignore-certificate-errors", `--host-resolver-rules=MAP i.pximg.net 127.0.0.1:${server.address().port}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    const item = { url: original("123", 0), id: "123_p0", tweetId: "123", handle: "42" };
    const start = await panel.evaluate(item => chrome.runtime.sendMessage({ type: "DOWNLOAD", platform: "pixiv", handle: "42", items: [item] }), item);
    assert.equal(start.ok, true, start.error);
    const result = await waitFor(() => panel.evaluate(() => chrome.runtime.sendMessage({ type: "JOB" })), value => value.job?.status !== "running");
    assert.equal(headers?.referer, "https://www.pixiv.net/", JSON.stringify({ headers, job: result.job }));
    assert.equal(result.job.status, "complete", JSON.stringify(result.job));
    assert.equal(result.job.done, 1);
    const downloaded = await worker.evaluate(async () => { const { job } = await chrome.storage.local.get("job"); return (await chrome.downloads.search({ id: job.items[0].downloadId }))[0]; });
    assert.deepEqual(await readFile(downloaded.filename), imageBytes);
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-pixiv-download-")) await rm(dir, { recursive: true, force: true });
  }
});

test("Pixiv Ugoira is downloaded and encoded into a playable WebM", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-pixiv-ugoira-"));
  const key = await readFile(new URL("./fixtures/localhost-key.pem", import.meta.url));
  const cert = await readFile(new URL("./fixtures/localhost-cert.pem", import.meta.url));
  let archive;
  const server = https.createServer({ key, cert }, (req, res) => {
    if (req.headers.referer !== "https://www.pixiv.net/") { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { "Content-Type": "application/zip" }); res.end(archive);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await browserPath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-proxy-server", "--ignore-certificate-errors", `--host-resolver-rules=MAP i.pximg.net 127.0.0.1:${server.address().port}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    const frame = await panel.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 32; c.getContext("2d").fillRect(0, 0, 32, 32); return c.toDataURL("image/png").split(",")[1]; });
    archive = Buffer.from(zipSync({ "000000.png": Buffer.from(frame, "base64"), "000001.png": Buffer.from(frame, "base64") }));
    const item = { kind: "video", url: "https://i.pximg.net/img-zip-ugoira/img/2024/01/02/03/04/05/123_ugoira1920x1080.zip", id: "123_ugoira", tweetId: "123", handle: "42", frames: [{ file: "000000.png", delay: 250 }, { file: "000001.png", delay: 250 }] };
    const start = await panel.evaluate(item => chrome.runtime.sendMessage({ type: "DOWNLOAD", platform: "pixiv", handle: "42", items: [item] }), item);
    assert.equal(start.ok, true, start.error);
    const result = await waitFor(() => panel.evaluate(() => chrome.runtime.sendMessage({ type: "JOB" })), value => value.job?.status !== "running");
    assert.equal(result.job.status, "complete", JSON.stringify(result.job));
    const download = await worker.evaluate(async () => { const { job } = await chrome.storage.local.get("job"); return (await chrome.downloads.search({ id: job.items[0].downloadId }))[0]; });
    const bytes = await readFile(download.filename);
    assert.deepEqual([...bytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], "output must be a WebM container");
    assert.ok(bytes.length > 100);
    const played = await panel.evaluate(async data => {
      const raw = Uint8Array.from(atob(data), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([raw], { type: "video/webm" }));
      const video = document.createElement("video"); video.muted = true; video.src = url;
      try {
        await video.play();
        return await Promise.race([new Promise(resolve => video.requestVideoFrameCallback(() => resolve(true))), new Promise(resolve => setTimeout(() => resolve(false), 4000))]);
      } finally { video.pause(); URL.revokeObjectURL(url); }
    }, bytes.toString("base64"));
    assert.equal(played, true, "Chromium should decode an output video frame");
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve));
    if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-pixiv-ugoira-")) await rm(dir, { recursive: true, force: true });
  }
});
