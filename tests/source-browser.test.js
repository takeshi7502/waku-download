import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

test("Chrome downloads the requested #nguon.txt with correct UTF-8 contents", { timeout: 60000 }, async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "waku-source-test-"));
  const userData = path.join(temp, "profile");
  const downloadsPath = path.join(temp, "downloads");
  const extension = process.env.WAKU_EXTENSION_DIR || fileURLToPath(new URL("../extension", import.meta.url));
  let context;
  try {
    await mkdir(path.join(userData, "Default"), { recursive: true });
    await mkdir(downloadsPath);
    await writeFile(path.join(userData, "Default", "Preferences"), JSON.stringify({ download: { default_directory: downloadsPath, directory_upgrade: true, prompt_for_download: false } }));
    context = await chromium.launchPersistentContext(userData, { executablePath: await browserPath(), headless: true, downloadsPath, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).hostname;
    await worker.evaluate(() => {
      const download = chrome.downloads.download.bind(chrome.downloads);
      const search = chrome.downloads.search.bind(chrome.downloads);
      globalThis.sourceSettings = null;
      chrome.downloads.download = async settings => { if (settings.filename.endsWith("/#nguon.txt")) { sourceSettings = settings; return download(settings); } return 9000000; };
      chrome.downloads.search = async query => query.id === 9000000 ? [{ id: 9000000, state: "in_progress" }] : search(query);
    });
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    const result = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "DOWNLOAD", platform: "x", handle: "example", name: "Tác giả Việt", profileId: "987654321", items: [{ url: "https://pbs.twimg.com/media/test.jpg", handle: "example", tweetId: "123" }] }));
    assert.equal(result.ok, true);
    const deadline = Date.now() + 10000;
    let source;
    while (Date.now() < deadline) {
      [source] = await panel.evaluate(() => chrome.downloads.search({ urlRegex: "^data:text/plain" }));
      if (source?.state === "complete") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(source?.state, "complete", JSON.stringify(source));
    const sourceSettings = await worker.evaluate(() => globalThis.sourceSettings);
    assert.equal(sourceSettings.filename, "WakuDownload/X/example (1)/#nguon.txt");
    const actualPath = path.resolve(source.filename);
    assert.ok(actualPath.toLowerCase().startsWith(path.resolve(downloadsPath).toLowerCase() + path.sep), "test download must stay inside its temporary directory");
    // Playwright stores downloads under generated temporary names; the requested
    // filename above is what Chrome uses outside the test runner.
    const content = await readFile(actualPath, "utf8");
    assert.ok(content.startsWith("\uFEFF"), "UTF-8 BOM helps Windows text editors detect Vietnamese");
    assert.match(content, /Tên: Tác giả Việt/);
    assert.match(content, /Link hồ sơ: https:\/\/x\.com\/i\/user\/987654321/);
  } finally {
    await context?.close();
    const expected = path.resolve(tmpdir()) + path.sep;
    if (path.resolve(temp).startsWith(expected) && path.basename(temp).startsWith("waku-source-test-")) await rm(temp, { recursive: true, force: true });
  }
});
