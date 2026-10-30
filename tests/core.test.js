import test from "node:test";
import assert from "node:assert/strict";
import "../extension/src/platforms/x.js";
const { profile, photo, extract, normalize, filename } = globalThis.WakuX;

test("validates profile names and limits navigation to actual profiles", () => {
  assert.equal(profile(" @_Pi_cos "), "_Pi_cos");
  assert.equal(profile("https://x.com/_Pi_cos/media"), "_Pi_cos");
  assert.equal(profile("https://twitter.com/example"), "example");
  for (const value of ["https://evil.com/example", "https://x.com/home", "https://x.com/a/status/123", "https://x.com/i/flow/login", "../../bad", "@", "https://x.com.evil.com/test"]) assert.equal(profile(value), null, value);
});
test("normalizes image sizes to originals without accepting arbitrary download hosts", () => {
  const first = photo("https://pbs.twimg.com/media/ABC_123-xy.jpg:large");
  assert.equal(first.url, "https://pbs.twimg.com/media/ABC_123-xy?format=jpg&name=orig");
  assert.equal(photo("https://pbs.twimg.com/media/ABC_123-xy?format=png&name=small").format, "png");
  for (const value of ["http://pbs.twimg.com/media/abc.jpg", "https://pbs.twimg.com.evil.com/media/abc.jpg", "https://pbs.twimg.com/profile_images/abc.jpg", "https://pbs.twimg.com/tweet_video_thumb/abc.jpg", "https://pbs.twimg.com/media/abc?format=html", "https://evil.com/media/abc.jpg"]) assert.equal(photo(value), null, value);
});
const tweet = (handle, id, media) => ({ rest_id: id, core: { user_results: { result: { legacy: { screen_name: handle } } } }, legacy: { full_text: "Four photos", created_at: "2026-10-29", extended_entities: { media } } });
const image = id => ({ type: "photo", media_url_https: `https://pbs.twimg.com/media/${id}.jpg` });
test("extracts every photo in a multi-photo tweet and nested quoted tweets, excludes video", () => {
  const original = tweet("example", "123", [image("one"), image("two"), image("three"), image("four"), { type: "video", media_url_https: "https://pbs.twimg.com/media/video.jpg" }]);
  original.quoted_status_result = { result: tweet("other", "456", [image("quoted")]) };
  const response = { data: { instructions: [{ content: { tweet_results: { result: original } } }] } };
  const all = extract(response);
  assert.equal(all.length, 5);
  assert.equal(all.filter(item => normalize(item, "example")).length, 4);
  assert.ok(all.every(item => item.source === "api"));
  assert.equal(extract({ a: original, b: original }).length, 5);
});
test("supports X's newer user core shape and refuses unowned/unidentified media", () => {
  const item = tweet("example", "123", [image("one")]);
  item.core.user_results.result = { core: { screen_name: "example" } };
  assert.equal(extract(item)[0].handle, "example");
  delete item.core;
  assert.equal(extract(item).length, 0);
  assert.equal(normalize({ url: "https://pbs.twimg.com/media/a.jpg", handle: "example", tweetId: "../escape" }, "example"), null);
  assert.equal(filename({ url: "https://pbs.twimg.com/media/a.jpg", handle: "example", tweetId: "123" }), "WakuDownload/X/example/123_a.jpg");
});
test("finds the numeric profile ID only for the requested X account", () => {
  const user = { __typename: "User", rest_id: "987654321", core: { screen_name: "example", name: "Tên tác giả" } };
  const unrelated = { __typename: "User", rest_id: "111", core: { screen_name: "other", name: "Other" } };
  const result = extract({ data: [user, unrelated] }, "example");
  assert.equal(result.account.id, "987654321");
  assert.equal(result.account.name, "Tên tác giả");
  assert.equal(extract({ data: [user] }, "other").account, null);
});
