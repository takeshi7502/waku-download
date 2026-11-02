import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import https from "node:https";
import { mkdtemp, readdir, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from "mediabunny";

const extension = fileURLToPath(new URL("../extension", import.meta.url));
async function executable() {
  if (process.env.WAKU_CHROMIUM) return process.env.WAKU_CHROMIUM;
  try { await access(chromium.executablePath()); return chromium.executablePath(); } catch {}
  const root = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright");
  if (root) for (const dir of (await readdir(root).catch(() => [])).filter(x => /^chromium-\d+$/.test(x)).sort().reverse()) { const exe = path.join(root, dir, "chrome-win64", "chrome.exe"); try { await access(exe); return exe; } catch {} }
  return chromium.executablePath();
}
async function waitFor(read, predicate) { for (let i = 0; i < 150; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); } assert.fail("Timed out waiting for Facebook video"); }
test("Facebook Reel DASH downloads both signed streams and merges audio with video", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "waku-facebook-dash-"));
  const [key, cert, video, audio] = await Promise.all(["localhost-key.pem", "localhost-cert.pem", "dash-video.mp4", "dash-audio.mp4"].map(name => readFile(new URL(`./fixtures/${name}`, import.meta.url))));
  const requests = [];
  const server = https.createServer({ key, cert }, (req, res) => { requests.push(req.url); const body = req.url.startsWith("/audio.mp4") ? audio : video; res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": body.length }); res.end(body); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(dir, { executablePath: await executable(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-proxy-server", "--ignore-certificate-errors", `--host-resolver-rules=MAP video.xx.fbcdn.net 127.0.0.1:${server.address().port}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const manifest = `<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation codecs="avc1.640028" bandwidth="1000"><BaseURL>https://video.xx.fbcdn.net/video.mp4?signature=1&amp;token=2</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation codecs="mp4a.40.2" bandwidth="128"><BaseURL>https://video.xx.fbcdn.net/audio.mp4?signature=3&amp;token=4</BaseURL></Representation></AdaptationSet></Period></MPD>`;
    const reel = { __typename: "Video", id: "1437239295091171", creation_story: { short_form_video_context: { video_owner: { id: "61557674197239", name: "Artist" }, playback_video: { videoDeliveryResponseFragment: { videoDeliveryResponseResult: { dash_manifests: [{ manifest_xml: manifest }] } } } } } };
    await context.route("https://web.facebook.com/**", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<script type="application/json">${JSON.stringify(reel)}</script><main>Reel</main>` }));
    const page = await context.newPage(); await page.goto("https://web.facebook.com/reel/1437239295091171");
    await page.locator("#waku-launcher").click(); const panel = page.frameLocator("#waku-panel iframe");
    await panel.locator("#image-count").filter({ hasText: "1 video" }).waitFor();
    assert.equal(await panel.locator("#profile-name").textContent(), "Artist");
    await panel.locator("#download").click();
    const job = await waitFor(() => worker.evaluate(async () => (await chrome.storage.local.get("job")).job), job => job && job.status !== "running");
    assert.equal(job.status, "complete", JSON.stringify(job.items.map(x => x.error)));
    assert.deepEqual(new Set(requests), new Set(["/video.mp4?signature=1&token=2", "/audio.mp4?signature=3&token=4"]));
    const file = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0].filename, job.items[0].downloadId);
    const bytes = await readFile(file);
    const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: ALL_FORMATS });
    try {
      const videoTrack = await input.getPrimaryVideoTrack(), audioTrack = await input.getPrimaryAudioTrack();
      assert.ok(videoTrack && audioTrack, "output must include both video and audio");
      assert.equal(await videoTrack.getCodec(), "avc"); assert.equal(await audioTrack.getCodec(), "aac");
      assert.ok(await new EncodedPacketSink(videoTrack).getFirstPacket());
      assert.ok(await new EncodedPacketSink(audioTrack).getFirstPacket());
    } finally { input.dispose(); }
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve));
    if (path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith("waku-facebook-dash-")) await rm(dir, { recursive: true, force: true });
  }
});
