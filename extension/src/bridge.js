/* Passive listener: reads responses X already requested; never sends API requests. */
(() => {
  "use strict";
  if (window.__wakuBridge) return;
  window.__wakuBridge = true;
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = Reflect.apply(original, this, args);
      window.dispatchEvent(new Event("waku:navigate"));
      return result;
    };
  }
  // A small replay buffer covers listener startup without retaining the timeline twice.
  const cache = [];
  const apiUrl = value => {
    try {
      const url = new URL(value, location.origin);
      const x = /^(www\.)?(x|twitter)\.com$/.test(url.hostname) && url.pathname.includes("/graphql/") && /(?:UserMedia|UserTweets|UserByScreenName|UserByRestId|TweetDetail|TweetResultByRestId|SearchTimeline)/.test(url.pathname);
      const facebook = /^(?:(?:www|web|m|mbasic)\.)?facebook\.com$/.test(url.hostname) && url.pathname.startsWith("/api/graphql");
      const pixiv = url.hostname === "www.pixiv.net" && /^\/ajax\/illust\/\d+(?:\/ugoira_meta)?\/?$/.test(url.pathname);
      return x || facebook || pixiv;
    } catch { return false; }
  };
  function consume(data, url) {
    cache.push({ data, url });
    if (cache.length > 8) cache.shift();
    window.postMessage({ type: "WAKU_DATA", data, url }, location.origin);
  }
  function consumeText(text, url) {
    // Facebook may send multiple newline-delimited GraphQL results or a CSRF prefix.
    const cleaned = text.replace(/^\s*for\s*\(\s*;;\s*\);\s*/, "");
    try { consume(JSON.parse(cleaned), url); return; } catch {}
    for (const line of cleaned.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { consume(JSON.parse(line), url); } catch {}
    }
  }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const result = Reflect.apply(originalFetch, this, args);
    const url = args[0] instanceof Request ? args[0].url : args[0];
    if (apiUrl(url)) {
      result.then(response => {
        if (response.ok) response.clone().text().then(text => consumeText(text, String(url))).catch(() => {});
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
        try { if (this.responseType === "json") consume(this.response, String(args[1])); else consumeText(this.responseText, String(args[1])); } catch { /* Non-JSON response. */ }
      }, { once: true });
    }
    return Reflect.apply(open, this, args);
  };
  window.addEventListener("message", event => {
    if (event.source === window && event.origin === location.origin && event.data?.type === "WAKU_READ_CACHE") {
      for (const entry of cache) window.postMessage({ type: "WAKU_DATA", ...entry, replay: true }, location.origin);
    }
  });
})();
