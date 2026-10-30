import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const core = await readFile(new URL("../extension/core.js", import.meta.url), "utf8");
const facebook = await readFile(new URL("../extension/facebook.js", import.meta.url), "utf8");
const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));

test("handles invalidation during startup, message delivery and runtime checks", async t => {
  for (const mode of ["throw", "reject", "missing-id", "id-getter", "runtime-listener", "storage-listener"]) {
    await t.test(mode, async () => {
      const timers = new Map();
      let sequence = 0;
      let invalid = false;
      let calls = 0;
      let observer;
      const window = new EventTarget();
      window.postMessage = () => {};
      const document = new EventTarget();
      document.documentElement = {};
      document.querySelector = () => null;
      const runtime = {
        id: "test",
        getURL: value => `chrome-extension://test/${value}`,
        onMessage: { addListener() { if (mode === "runtime-listener") throw new Error("Extension context invalidated."); } },
        sendMessage: message => {
          calls++;
          if (invalid) {
            const error = new Error("Extension context invalidated.");
            if (mode === "throw") throw error;
            return Promise.reject(error);
          }
          return Promise.resolve(message.type === "PANEL_INIT" ? { enabled: false } : { state: null });
        }
      };
      const setTimer = (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; };
      const context = vm.createContext({
        URL, AbortController, window, document,
        location: { href: "https://x.com/example/media", origin: "https://x.com", pathname: "/example/media" },
        chrome: { runtime, storage: { onChanged: { addListener() { if (mode === "storage-listener") throw new Error("Extension context invalidated."); } } } },
        MutationObserver: class {
          constructor(callback) { this.callback = callback; this.connected = false; observer = this; }
          observe() { this.connected = true; }
          disconnect() { this.connected = false; }
        },
        setTimeout: setTimer, setInterval: setTimer,
        clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id)
      });
      vm.runInContext(core, context);
      vm.runInContext(facebook, context);
      assert.doesNotThrow(() => vm.runInContext(content, context));
      await flush();
      if (mode.endsWith("listener")) {
        assert.ok(!observer?.connected, "failed initialization must not leave a DOM observer running");
        assert.equal(timers.size, 0, "failed initialization must cancel pending work");
        assert.equal(calls, 0, "failed initialization must not send any messages");
        return;
      }
      assert.ok(observer.connected);
      const callsBefore = calls;
      invalid = true;
      if (mode === "missing-id" || mode === "id-getter") {
        if (mode === "id-getter") Object.defineProperty(runtime, "id", { get() { throw new Error("Extension context invalidated."); } });
        else runtime.id = undefined;
        observer.callback();
      } else {
        // The pending save reproduces content.js -> sendMessage after a reload.
        const [id, timer] = [...timers].find(([, timer]) => timer.delay === 300);
        timers.delete(id);
        assert.doesNotThrow(() => timer.callback());
      }
      await flush();
      assert.equal(observer.connected, false, "DOM observation must stop after invalidation");
      assert.equal(timers.size, 0, "all pending reads, saves and intervals must be cleared");
      const callsAfter = calls;
      assert.equal(callsAfter, callsBefore + (["missing-id", "id-getter"].includes(mode) ? 0 : 1));
      observer.callback();
      window.dispatchEvent(new Event("scroll"));
      await flush();
      assert.equal(calls, callsAfter, "retired scripts must not keep sending messages");
      assert.equal(timers.size, 0, "page activity must not restart a retired script");
    });
  }
});
