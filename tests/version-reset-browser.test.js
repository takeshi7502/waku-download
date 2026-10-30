import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

test("reloads an unpacked installation from 1.0.0 to 1.1.0 and retains its history", { timeout: 60000 }, async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "waku-version-test-"));
  const extension = path.join(temp, "extension");
  const userData = path.join(temp, "profile");
  const source = process.env.WAKU_EXTENSION_DIR || fileURLToPath(new URL("../extension", import.meta.url));
  let context;
  try {
    await cp(source, extension, { recursive: true });
    const manifestPath = path.join(extension, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.version, "1.1.0");
    await writeFile(manifestPath, JSON.stringify({ ...manifest, version: "1.0.0" }));
    context = await chromium.launchPersistentContext(userData, { executablePath: await browserPath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).hostname;
    await worker.evaluate(() => chrome.storage.local.set({ history: { "example:photo": 123 } }));
    const manager = await context.newPage();
    await manager.goto("chrome://extensions/");
    await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await manager.evaluate(id => chrome.developerPrivate.reload(id, { failQuietly: true }), extensionId);
    const until = Date.now() + 10000;
    let info;
    while (Date.now() < until) {
      info = await manager.evaluate(id => new Promise(resolve => chrome.developerPrivate.getExtensionInfo(id, resolve)), extensionId);
      if (info?.version === "1.1.0" && info.state === "ENABLED") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(info?.version, "1.1.0");
    assert.equal(info?.state, "ENABLED");
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    const saved = await panel.evaluate(() => chrome.storage.local.get("history"));
    assert.equal(saved.history["example:photo"], 123);
  } finally {
    await context?.close();
    const expected = path.resolve(tmpdir()) + path.sep;
    if (path.resolve(temp).startsWith(expected) && path.basename(temp).startsWith("waku-version-test-")) await rm(temp, { recursive: true, force: true });
  }
});
