import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const core = await readFile(new URL("../extension/src/platforms/x.js", import.meta.url), "utf8");
const facebook = await readFile(new URL("../extension/src/platforms/facebook.js", import.meta.url), "utf8");
const pixiv = await readFile(new URL("../extension/src/platforms/pixiv.js", import.meta.url), "utf8");
const workerCode = await readFile(new URL("../extension/src/background.js", import.meta.url), "utf8");
const image = id => ({ url: `https://pbs.twimg.com/media/${id}.jpg`, handle: "example", tweetId: "123", source: "api" });
async function harness(saved = {}, options = {}) {
  const store = structuredClone(saved);
  const session = structuredClone(options.session || {});
  const downloads = new Map(options.downloads || []);
  let id = downloads.size;
  let onMessage;
  let onChanged;
  let onAlarm;
  const calls = [];
  const sourceCalls = [];
  const writes = [];
  const operations = [];
  let context;
  const chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener: listener => { onMessage = listener; } } },
    storage: {
      local: { get: async () => structuredClone(store), set: async values => {
        const snapshot = structuredClone(values);
        writes.push({ bytes: JSON.stringify(snapshot).length });
        operations.push("save");
        await options.beforeLocalWrite?.();
        Object.assign(store, snapshot);
      } },
      session: { get: async () => structuredClone(session), set: async values => {
        const snapshot = structuredClone(values);
        await options.beforeSessionWrite?.();
        Object.assign(session, snapshot);
      }, remove: async keys => { for (const key of keys) delete session[key]; } }
    },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener: listener => { onAlarm = listener; } } },
    downloads: {
      download: async settings => {
        if (settings.filename.endsWith("/#nguon.txt")) {
          sourceCalls.push(settings);
          if (options.failSource?.(settings)) throw new Error("SOURCE_FAILED");
          const sourceId = -sourceCalls.length;
          downloads.set(sourceId, { id: sourceId, state: options.sourceState || "complete", url: settings.url });
          return sourceId;
        }
        calls.push(settings);
        operations.push("download");
        if (options.fail?.(settings)) throw new Error("NETWORK_FAILED");
        const next = ++id;
        downloads.set(next, { id: next, state: "in_progress", url: settings.url });
        return next;
      },
      search: async query => downloads.has(query.id) ? [downloads.get(query.id)] : [],
      cancel: async downloadId => { downloads.get(downloadId).state = "interrupted"; },
      onChanged: { addListener: listener => { onChanged = listener; } }
    }
  };
  context = vm.createContext({ chrome, URL, crypto: { randomUUID }, console, importScripts: (...files) => { for (const file of files) vm.runInContext(file.endsWith("pixiv.js") ? pixiv : file.endsWith("facebook.js") ? facebook : core, context); } });
  vm.runInContext(options.workerCode || workerCode, context);
  const sendFrom = (message, sender) => new Promise(resolve => {
    let replied = false;
    const pending = onMessage(message, sender, value => { replied = true; resolve(value); });
    if (pending !== true && !replied) resolve(null);
  });
  const send = message => sendFrom(message, { url: "chrome-extension://test/panel.html", tab: { id: 1 } });
  const flush = () => send({ type: "JOB" });
  await flush();
  return { store, session, calls, sourceCalls, writes, operations, downloads, send, sendFrom, flush, alarm: async () => { onAlarm({ name: "waku-queue" }); return flush(); }, complete: async (downloadId, state = "complete") => {
    downloads.get(downloadId).state = state;
    onChanged({ id: downloadId, state: { current: state }, ...(state === "interrupted" ? { error: { current: "NETWORK_FAILED" } } : {}) });
    return flush();
  } };
}
test("limits concurrency to three; advances on completion and saves only successful images", async () => {
  const h = await harness();
  const result = await h.send({ type: "DOWNLOAD", handle: "example", items: ["a", "b", "c", "d", "a"].map(image) });
  assert.equal(result.job.total, 4);
  assert.equal(result.job.active, 3);
  assert.equal(h.calls.length, 3);
  await h.complete(1);
  assert.equal(h.calls.length, 4);
  await h.complete(2, "interrupted");
  await h.complete(3);
  const final = await h.complete(4);
  assert.equal(final.job.done, 3);
  assert.equal(final.job.failed, 1);
  assert.equal(final.job.status, "finished_with_errors");
  assert.equal(Object.keys(h.store.history).length, 3);
  const retry = await h.send({ type: "RETRY_DOWNLOAD" });
  assert.equal(retry.job.active, 1);
  assert.equal(h.calls.length, 5);
  await h.complete(5);
  const skipped = await h.send({ type: "DOWNLOAD", handle: "example", items: ["a", "b", "c", "d"].map(image) });
  assert.equal(skipped.job.skipped, 4);
  assert.equal(skipped.job.total, 0);
  assert.equal(skipped.job.status, "complete");
});

test("refills download slots before storage writes and reading progress never saves the full job", async () => {
  const h = await harness();
  await h.send({ type: "DOWNLOAD", handle: "example", items: ["a", "b", "c", "d", "e"].map(image) });
  assert.equal(h.writes.length, 1, "initial three IDs should share one checkpoint");
  h.operations.length = 0;
  const before = h.writes.length;
  await h.complete(1);
  assert.deepEqual(h.operations, ["download", "save"], "the next photo must start before saving progress");
  assert.equal(h.writes.length - before, 1, "completion and refilling should share one checkpoint");
  await h.flush(); await h.flush();
  assert.equal(h.writes.length - before, 1, "progress reads must not rewrite the queue");
});

test("a pending scan save cannot hold up active downloads", async () => {
  let release;
  let started;
  const blocked = new Promise(resolve => { release = resolve; });
  const writing = new Promise(resolve => { started = resolve; });
  const h = await harness({}, { beforeSessionWrite: async () => { started(); await blocked; } });
  await h.send({ type: "DOWNLOAD", handle: "example", items: ["a", "b", "c", "d"].map(image) });
  const saving = h.sendFrom({ type: "SAVE_SCAN", state: { handle: "example", items: [image("new")], selected: [] } }, { url: "https://x.com/example/media", tab: { id: 1 } });
  await writing;
  try {
    await Promise.race([h.complete(1), new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("download queue is blocked by a scan save")), 1000);
      timer.unref();
    })]);
    assert.equal(h.calls.length, 4, "download should refill while the session write is still pending");
  } finally { release(); await saving; }
});

test("isolates saved collections by tab/profile and restores selected images without accepting arbitrary URLs", async () => {
  const h = await harness({ panelEnabled: true });
  const tab = id => ({ url: "https://x.com/example/media", tab: { id } });
  const saved = await h.sendFrom({ type: "SAVE_SCAN", state: { handle: "example", profileId: "987654321", items: [image("a"), image("a"), { ...image("bad"), url: "https://evil.com/a.jpg" }], selected: ["a", "bad"], selectNew: false, scrollTop: 450, avatar: "https://evil.com/avatar.jpg" } }, tab(1));
  assert.equal(saved.ok, true);
  await h.sendFrom({ type: "SAVE_SCAN", state: { handle: "example", items: [image("b")], selected: [] } }, tab(2));
  const first = await h.sendFrom({ type: "LOAD_SCAN", handle: "example" }, tab(1));
  assert.equal(first.state.items.length, 1);
  assert.deepEqual(Array.from(first.state.selected), ["a"]);
  assert.equal(first.state.avatar, null);
  assert.equal(first.state.profileId, "987654321");
  assert.equal(first.state.selectNew, false);
  assert.equal(first.state.scrollTop, 450);
  const second = await h.sendFrom({ type: "LOAD_SCAN", handle: "example" }, tab(2));
  assert.equal(second.state.items[0].id, "b");
  await h.sendFrom({ type: "PANEL_COLLAPSED", collapsed: true }, tab(1));
  assert.equal((await h.sendFrom({ type: "PANEL_INIT" }, tab(1))).collapsed, true);
  assert.equal((await h.sendFrom({ type: "PANEL_INIT" }, tab(2))).collapsed, false);
  const restored = await harness(h.store, { session: h.session });
  assert.equal((await restored.sendFrom({ type: "LOAD_SCAN", handle: "example" }, tab(1))).state.items[0].id, "a");
  assert.equal(await h.sendFrom({ type: "LOAD_SCAN", handle: "example" }, { url: "https://evil.com/", tab: { id: 1 } }), null);
  assert.equal(await h.sendFrom({ type: "DOWNLOAD", handle: "example", items: [image("a")] }, tab(1)), null, "web page content cannot start downloads directly");
});
test("Facebook downloads use signed CDN URLs, separate folders and a separate saved-image history", async () => {
  const h = await harness({ history: { "example:123": 1 } });
  const signed = "https://scontent.xx.fbcdn.net/v/t39/a_n.jpg?oh=signature&oe=abc";
  const photo = { platform: "facebook", handle: "example", id: "123", url: signed };
  const started = await h.send({ type: "DOWNLOAD", platform: "facebook", handle: "example", items: [photo] });
  assert.equal(started.job.platform, "facebook");
  assert.equal(started.job.active, 1);
  assert.equal(h.calls[0].url, signed);
  assert.equal(h.calls[0].filename, "WakuDownload/Facebook/example (1)/123.jpg");
  await h.complete(1);
  assert.ok(h.store.history["facebook:example:123"]);
  const skipped = await h.send({ type: "DOWNLOAD", platform: "facebook", handle: "example", items: [photo] });
  assert.equal(skipped.job.skipped, 1);
  assert.equal(h.sourceCalls.length, 1, "a batch with no photos to download should not create another source file");
  const invalid = await h.send({ type: "DOWNLOAD", platform: "facebook", handle: "example", items: [{ ...photo, url: "https://evil.com/v/a.jpg" }] });
  assert.equal(invalid.ok, false);
});
test("creates one UTF-8 source file in the photo folder with a stable X profile link", async () => {
  const h = await harness();
  const result = await h.send({ type: "DOWNLOAD", handle: "example", name: "Tên tác giả", profileId: "987654321", items: [image("a"), image("b")] });
  assert.equal(result.job.total, 2);
  assert.equal(result.job.sourceStatus, "complete");
  assert.equal(h.sourceCalls.length, 1);
  assert.equal(h.sourceCalls[0].filename, "WakuDownload/X/example (2)/#nguon.txt");
  const text = decodeURIComponent(h.sourceCalls[0].url.split(",")[1]);
  assert.ok(text.startsWith("\uFEFF"));
  assert.match(text, /Tên: Tên tác giả/);
  assert.match(text, /ID: 987654321/);
  assert.match(text, /Link hồ sơ: https:\/\/x\.com\/i\/user\/987654321/);
  assert.deepEqual(Object.keys(h.store.history), [], "source files must not enter the photo archive");
});
test("writes numeric Facebook links and falls back to a username when no ID is available", async () => {
  const signed = "https://scontent.xx.fbcdn.net/v/t39/a_n.jpg?oh=signature";
  const h = await harness();
  const photo = { handle: "100075970176818", id: "123", url: signed };
  await h.send({ type: "DOWNLOAD", platform: "facebook", handle: photo.handle, name: "火只木夏", items: [photo] });
  assert.equal(h.sourceCalls[0].filename, "WakuDownload/Facebook/100075970176818 (1)/#nguon.txt");
  assert.match(decodeURIComponent(h.sourceCalls[0].url.split(",")[1]), /https:\/\/www\.facebook\.com\/profile\.php\?id=100075970176818/);
  await h.complete(1);
  await h.send({ type: "DOWNLOAD", platform: "facebook", handle: "author.name", name: "Tác giả", profileId: "100075970176818", items: [{ ...photo, handle: "author.name", id: "456" }] });
  assert.match(decodeURIComponent(h.sourceCalls[1].url.split(",")[1]), /facebook\.com\/profile\.php\?id=100075970176818/);
  await h.complete(2);
  await h.send({ type: "DOWNLOAD", handle: "other", name: "Other", items: [{ ...image("c"), handle: "other" }] });
  assert.match(decodeURIComponent(h.sourceCalls[2].url.split(",")[1]), /Link hồ sơ: https:\/\/x\.com\/other/);
});
test("waits for source-file completion and allows retrying an interrupted source file", async () => {
  const h = await harness({}, { sourceState: "in_progress" });
  await h.send({ type: "DOWNLOAD", handle: "example", items: [image("a")] });
  const photoDone = await h.complete(1);
  assert.equal(photoDone.job.status, "running");
  const interrupted = await h.complete(-1, "interrupted");
  assert.equal(interrupted.job.status, "finished_with_errors");
  assert.equal(interrupted.job.sourceStatus, "failed");
  const retry = await h.send({ type: "RETRY_DOWNLOAD" });
  assert.equal(retry.job.sourceStatus, "active");
  assert.equal(h.calls.length, 1, "retrying the source file must not redownload successful photos");
  const completed = await h.complete(-2);
  assert.equal(completed.job.status, "complete");
  assert.equal(completed.job.sourceStatus, "complete");
});
test("folder count reflects this batch after duplicates and saved photos are removed, including retries", async () => {
  const h = await harness({ history: { "example:a": 1 } });
  const result = await h.send({ type: "DOWNLOAD", handle: "example", items: ["a", "b", "c", "b"].map(image) });
  assert.equal(result.job.folderCount, 2);
  assert.equal(result.job.skipped, 1);
  assert.deepEqual(h.calls.map(call => call.filename), ["WakuDownload/X/example (2)/123_b.jpg", "WakuDownload/X/example (2)/123_c.jpg"]);
  await h.complete(1, "interrupted");
  await h.complete(2);
  await h.send({ type: "RETRY_DOWNLOAD" });
  assert.equal(h.calls[2].filename, "WakuDownload/X/example (2)/123_b.jpg");
  await h.complete(3);
});
test("resuming an older saved job keeps its original folder", async () => {
  const h = await harness();
  await h.send({ type: "DOWNLOAD", handle: "example", items: ["a", "b", "c", "d"].map(image) });
  delete h.store.job.folderCount;
  delete h.store.job.pathVersion;
  h.downloads.get(1).state = "complete";
  const restored = await harness(h.store, { downloads: h.downloads });
  assert.equal(restored.calls.length, 1);
  assert.equal(restored.calls[0].filename, "XDownload/example/123_d.jpg");
});
test("resuming a legacy job retains its counted folder and history", async () => {
  const h = await harness();
  await h.send({ type: "DOWNLOAD", handle: "example", items: ["a", "b", "c", "d"].map(image) });
  delete h.store.job.pathVersion;
  h.downloads.get(1).state = "complete";
  const restored = await harness(h.store, { downloads: h.downloads });
  assert.equal(restored.calls[0].filename, "XDownload/example (4)/123_d.jpg");
  assert.ok(restored.store.history["example:a"]);
});
test("X and Facebook keep separate profile collections even when the tab and profile name match", async () => {
  const h = await harness();
  const signed = "https://scontent.xx.fbcdn.net/v/t39/a_n.jpg?oh=signature";
  const x = { url: "https://x.com/example/media", tab: { id: 1 } };
  const fb = { url: "https://web.facebook.com/example/photos", tab: { id: 1 } };
  await h.sendFrom({ type: "SAVE_SCAN", state: { handle: "example", items: [image("xphoto")], selected: [] } }, x);
  await h.sendFrom({ type: "SAVE_SCAN", state: { handle: "example", items: [{ handle: "example", id: "123", url: signed }], selected: ["123"] } }, fb);
  const xState = await h.sendFrom({ type: "LOAD_SCAN", handle: "example" }, x);
  const fbState = await h.sendFrom({ type: "LOAD_SCAN", handle: "example" }, fb);
  assert.equal(xState.state.items[0].id, "xphoto");
  assert.equal(fbState.state.items[0].id, "123");
  assert.equal(fbState.state.platform, "facebook");
});
test("handles immediate download errors, cancellation and explicit redownload", async () => {
  const h = await harness({}, { fail: settings => settings.url.includes("/bad?") });
  const result = await h.send({ type: "DOWNLOAD", handle: "example", items: ["bad", "a", "b", "c", "d"].map(image) });
  assert.equal(result.job.failed, 1);
  assert.equal(result.job.active, 3);
  assert.equal(result.job.queued, 1);
  const stopped = await h.send({ type: "CANCEL_DOWNLOAD" });
  assert.equal(stopped.job.cancelled, 4);
  assert.equal(stopped.job.active, 0);
  assert.equal(stopped.job.status, "cancelled");
  const invalid = await h.send({ type: "DOWNLOAD", handle: "example", items: [{ ...image("bad"), url: "https://evil.com/file.exe" }] });
  assert.equal(invalid.ok, false);
  const saved = await harness({ history: { "example:a": 1 } });
  const again = await saved.send({ type: "DOWNLOAD", handle: "example", items: [image("a")], skipSaved: false });
  assert.equal(again.job.active, 1);
});
test("recovers a persisted worker queue and advances files completed while asleep", async () => {
  const h = await harness();
  await h.send({ type: "DOWNLOAD", handle: "example", items: ["a", "b", "c", "d"].map(image) });
  h.downloads.get(1).state = "complete";
  const restored = await harness(h.store, { downloads: h.downloads });
  const result = await restored.flush();
  assert.equal(result.job.done, 1);
  assert.equal(result.job.active, 3);
  assert.equal(restored.calls.length, 1);
  assert.ok(restored.store.history["example:a"]);
});
