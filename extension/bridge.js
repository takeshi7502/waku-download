/* Passive listener: reads responses X already requested; never sends API requests. */
(() => {
  "use strict";
  if (window.__xdlBridge) return;
  window.__xdlBridge = true;
  // A small replay buffer covers listener startup without retaining the timeline twice.
  const cache = [];
  const apiUrl = value => {
    try {
      const url = new URL(value, location.origin);
      const x = /^(www\.)?(x|twitter)\.com$/.test(url.hostname) && url.pathname.includes("/graphql/") && /(?:UserMedia|UserTweets|TweetDetail|SearchTimeline)/.test(url.pathname);
      const facebook = /^(?:(?:www|web|m|mbasic)\.)?facebook\.com$/.test(url.hostname) && url.pathname.startsWith("/api/graphql");
      return x || facebook;
    } catch { return false; }
  };
  function consume(data) {
    cache.push(data);
    if (cache.length > 3) cache.shift();
    window.postMessage({ type: "XDL_DATA", data }, location.origin);
  }
  function consumeText(text) {
    // Facebook may send multiple newline-delimited GraphQL results or a CSRF prefix.
    const cleaned = text.replace(/^\s*for\s*\(\s*;;\s*\);\s*/, "");
    try { consume(JSON.parse(cleaned)); return; } catch {}
    for (const line of cleaned.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { consume(JSON.parse(line)); } catch {}
    }
  }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const result = Reflect.apply(originalFetch, this, args);
    if (apiUrl(args[0] instanceof Request ? args[0].url : args[0])) {
      result.then(response => {
        if (response.ok) response.clone().text().then(consumeText).catch(() => {});
      }).catch(() => {});
    }
    return result;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    const interested = apiUrl(args[1]);
    if (interested) {
      this.addEventListener("load", () => {
        if (this.status < 200 || this.status >= 300) return;
        try { if (this.responseType === "json") consume(this.response); else consumeText(this.responseText); } catch { /* Non-JSON response. */ }
      }, { once: true });
    }
    return Reflect.apply(open, this, args);
  };
  window.addEventListener("message", event => {
    if (event.source === window && event.origin === location.origin && event.data?.type === "XDL_READ_CACHE") {
      for (const data of cache) window.postMessage({ type: "XDL_DATA", data }, location.origin);
    }
  });
})();
