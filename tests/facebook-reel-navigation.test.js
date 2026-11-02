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
const stream = id => ({ __typename: "Video", id, playable_url_quality_hd: `https://video.xx.fbcdn.net/v/${id}.mp4?sig=${id}` });
const owner = (id, user, name) => ({ __typename: "Video", id, owner: { id: user, name } });
const initial = { ...stream("101"), ...owner("101", "42", "Artist One") };
const data = { nextStream: stream("102"), nextOwner: owner("102", "42", "Artist One"), otherStream: stream("103"), otherOwner: owner("103", "99", "Artist Two") };
test("Facebook Reel navigation reuses prefetched video and matches the correct owner", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-reel-navigation-")); let context;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await executable(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await context.route("https://web.facebook.com/**", route => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith("/api/graphql")) return route.fulfill({ json: data[u.searchParams.get("name")] });
      return route.fulfill({ contentType: "text/html", body: `<script type="application/json">${JSON.stringify(initial)}</script><main>Reel</main>` });
    });
    const page = await context.newPage(); await page.goto("https://web.facebook.com/reel/101");
    await page.locator("#waku-launcher").click(); const panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({ hasText: "1 video" }).waitFor();
    assert.equal(await panel.locator("#profile-name").textContent(), "Artist One");
    await panel.getByLabel("Chọn video v101").uncheck();
    await page.evaluate(async () => { await fetch("/api/graphql?name=nextStream"); await fetch("/api/graphql?name=nextOwner"); await fetch("/api/graphql?name=otherStream"); await fetch("/api/graphql?name=otherOwner"); });
    await page.waitForTimeout(350);
    await page.evaluate(() => history.pushState({}, "", "/reel/102"));
    await panel.getByLabel("Chọn video v102").waitFor();
    assert.equal(await panel.locator("#profile-name").textContent(), "Artist One");
    assert.equal(await panel.getByLabel("Chọn video v102").isChecked(), true);
    assert.equal(await panel.getByLabel("Chọn video v103").count(), 0);
    await page.evaluate(() => history.replaceState({}, "", "/reel/103"));
    await panel.getByLabel("Chọn video v103").waitFor();
    assert.equal(await panel.locator("#profile-name").textContent(), "Artist Two");
    await page.goBack();
    await panel.getByLabel("Chọn video v101").waitFor();
    assert.equal(await panel.getByLabel("Chọn video v101").isChecked(), false);
  } finally { await context?.close(); if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-reel-navigation-")) await rm(dir, { recursive: true, force: true }); }
});

test("Facebook Reel navigation fetches the current reel when it was not prefetched", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-reel-fallback-")); let context; const lookups = [];
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await executable(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await context.route("https://web.facebook.com/**", async route => {
      const u = new URL(route.request().url());
      if (u.pathname === "/watch/") {
        const id = u.searchParams.get("v"); lookups.push({ id, accept: route.request().headers().accept });
        if (id === "102") await new Promise(resolve => setTimeout(resolve, 1500));
        const user = id === "102" ? "42" : "99", name = id === "102" ? "Artist One" : "Artist Two";
        const html = `<script type="application/json">${JSON.stringify(stream(id))}</script><script type="application/json">${JSON.stringify(owner(id, user, name))}</script>`;
        return route.fulfill({ contentType: "text/html", body: html }).catch(() => {});
      }
      return route.fulfill({ contentType: "text/html", body: `<script type="application/json">${JSON.stringify(initial)}</script><main>Reel</main>` });
    });
    const page = await context.newPage(); await page.goto("https://web.facebook.com/reel/101");
    await page.locator("#waku-launcher").click(); const panel = page.frameLocator("#waku-panel iframe");
    await panel.getByLabel("Chọn video v101").waitFor();
    await page.evaluate(() => history.pushState({}, "", "/reel/102"));
    await page.waitForTimeout(800);
    await page.evaluate(() => history.pushState({}, "", "/reel/103"));
    await panel.getByLabel("Chọn video v103").waitFor();
    assert.equal(await panel.locator("#profile-name").textContent(), "Artist Two");
    assert.ok(lookups.some(value => value.id === "102"));
    assert.ok(lookups.some(value => value.id === "103" && value.accept.includes("text/html")));
    await page.waitForTimeout(1600);
    assert.equal(await panel.getByLabel("Chọn video v102").count(), 0, "late responses must not replace the current reel");
    await page.evaluate(() => history.pushState({}, "", "/reel/102"));
    await panel.getByLabel("Chọn video v102").waitFor();
    assert.equal(await panel.locator("#profile-name").textContent(), "Artist One");
  } finally { await context?.close(); if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-reel-fallback-")) await rm(dir, { recursive: true, force: true }); }
});

test("Facebook Reel lookup can be retried without reloading the page", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-reel-retry-")); let context; let attempts = 0;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await executable(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await context.route("https://web.facebook.com/**", route => {
      const u = new URL(route.request().url());
      if (u.pathname === "/watch/") {
        attempts++;
        if (attempts === 1) return route.fulfill({ status: 503 });
        const reel = { ...stream("104"), ...owner("104", "99", "Artist Two") };
        return route.fulfill({ contentType: "text/html", body: `<script type="application/json">${JSON.stringify(reel)}</script>` });
      }
      return route.fulfill({ contentType: "text/html", body: `<script type="application/json">${JSON.stringify(initial)}</script><main>Reel</main>` });
    });
    const page = await context.newPage(); await page.goto("https://web.facebook.com/reel/101");
    await page.locator("#waku-launcher").click(); const panel = page.frameLocator("#waku-panel iframe");
    await panel.getByLabel("Chọn video v101").waitFor();
    await page.evaluate(() => history.pushState({}, "", "/reel/104"));
    await panel.locator("#rescan-facebook").waitFor();
    await panel.locator("#rescan-facebook").click();
    await panel.getByLabel("Chọn video v104").waitFor();
    assert.equal(attempts, 2);
    assert.equal(await panel.locator("#profile-name").textContent(), "Artist Two");
  } finally { await context?.close(); if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-reel-retry-")) await rm(dir, { recursive: true, force: true }); }
});
