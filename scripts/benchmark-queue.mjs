// Measures extension queue/storage overhead with mocked downloads, not X network speed.
// Example: node scripts/benchmark-queue.mjs extension/src/background.js
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const core = await readFile(new URL("../extension/src/platforms/x.js", import.meta.url), "utf8");
const facebook = await readFile(new URL("../extension/src/platforms/facebook.js", import.meta.url), "utf8");
const paths = process.argv.slice(2);
if (!paths.length) paths.push("extension/src/background.js");
for (const file of paths) {
  const source = await readFile(file, "utf8");
  const store = {};
  const files = new Map();
  let messages, changed, nextId = 0, writes = 0, bytes = 0;
  let context;
  const chrome = {
    runtime: { getURL: value => `chrome-extension://test/${value}`, onMessage: { addListener: value => { messages = value; } } },
    storage: { local: {
      get: async () => structuredClone(store),
      set: async value => {
        const snapshot = structuredClone(value);
        writes++; bytes += Buffer.byteLength(JSON.stringify(snapshot));
        await new Promise(resolve => setTimeout(resolve, 2));
        Object.assign(store, snapshot);
      }
    } },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener() {} } },
    downloads: {
      download: async () => { const id = ++nextId; files.set(id, { id, state: "in_progress" }); return id; },
      search: async ({ id }) => files.has(id) ? [files.get(id)] : [],
      onChanged: { addListener: value => { changed = value; } }
    }
  };
  context = vm.createContext({ chrome, URL, crypto: { randomUUID }, importScripts: (...files) => { for (const file of files) vm.runInContext(file.endsWith("facebook.js") ? facebook : core, context); } });
  vm.runInContext(source, context);
  await vm.runInContext("serial", context);
  const items = Array.from({ length: 100 }, (_, index) => ({ url: `https://pbs.twimg.com/media/image${index}.jpg`, handle: "example", tweetId: String(1000 + index), text: "x".repeat(200) }));
  const started = performance.now();
  await new Promise(resolve => messages({ type: "DOWNLOAD", handle: "example", items }, { url: "chrome-extension://test/panel.html" }, resolve));
  for (let index = 0; index < items.length; index++) {
    const active = [...files.values()].find(file => file.state === "in_progress");
    if (!active) throw new Error("Queue stopped before all images were started.");
    active.state = "complete";
    changed({ id: active.id, state: { current: "complete" } });
    // Await the worker directly so the benchmark itself does not add progress reads.
    await vm.runInContext("serial", context);
  }
  const status = vm.runInContext("summary()", context);
  if (status.done !== items.length) throw new Error("Not all mocked downloads completed.");
  console.log(JSON.stringify({ file, images: items.length, storageDelayMs: 2, storageWrites: writes, serializedBytes: bytes, mockElapsedMs: Math.round(performance.now() - started) }));
}
