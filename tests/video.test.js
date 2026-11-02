import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const context = vm.createContext({ URL });
for (const name of ["x", "facebook", "pixiv"]) vm.runInContext(await readFile(new URL(`../extension/src/platforms/${name}.js`, import.meta.url), "utf8"), context);
const { WakuX: X, WakuFacebook: FB, WakuPixiv: P } = context;

test("X selects the highest bitrate MP4 and validates video URLs", () => {
  const node = { rest_id: "10", core: { user_results: { result: { core: { screen_name: "artist" } } } }, legacy: { extended_entities: { media: [{ type: "video", id_str: "44", media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/44/pu/img/a.jpg", video_info: { variants: [ { content_type: "application/x-mpegURL", url: "https://video.twimg.com/a.m3u8" }, { content_type: "video/mp4", bitrate: 100, url: "https://video.twimg.com/a.mp4?x=1" }, { content_type: "video/mp4", bitrate: 200, url: "https://video.twimg.com/b.mp4?x=2" } ] } }] } } };
  const items = X.extract(node, "artist");
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "video");
  assert.equal(items[0].url, "https://video.twimg.com/b.mp4?x=2");
  assert.equal(X.filename(items[0]), "WakuDownload/X/artist/10_v44.mp4");
  assert.equal(X.normalize({ ...items[0], url: "https://evil.test/b.mp4" }, "artist"), null);
  assert.equal(X.normalize(items[0], "other"), null);
});

test("X resolves a public video whose actual media payload omits its ID", () => {
  const tweetId = "1631692306506973185";
  const payload = { id_str: tweetId, user: { screen_name: "Kuukow002" }, text: "Video", mediaDetails: [{ type: "video", media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1631692245156995074/pu/img/a.jpg", video_info: { variants: [{ content_type: "video/mp4", bitrate: 1000, url: "https://video.twimg.com/ext_tw_video/1631692245156995074/pu/vid/720x1278/a.mp4?tag=12" }] } }] };
  const result = X.extractSyndication(payload, "Kuukow002", tweetId);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "v1631692245156995074");
  assert.equal(X.extractSyndication(payload, "other", tweetId).length, 0);
  assert.equal(X.extractSyndication(payload, "Kuukow002", "123").length, 0);
  const graph = { rest_id: tweetId, core: { user_results: { result: { core: { screen_name: "Kuukow002" } } } }, legacy: { extended_entities: { media: payload.mediaDetails } } };
  assert.equal(X.extract(graph, "Kuukow002")[0].id, "v1631692245156995074");
});

test("X accepts video variants from alternate payloads without a thumbnail", () => {
  const url = "https://video.twimg.com/ext_tw_video/44/pu/vid/1280x720/a.mp4";
  const payload = { id_str: "10", user: { screen_name: "artist" }, video: { variants: [{ type: "video/mp4", src: "https://video.twimg.com/ext_tw_video/44/pu/vid/320x180/a.mp4" }, { type: "video/mp4", src: url }] } };
  const item = X.extractSyndication(payload, "artist", "10")[0];
  assert.equal(item.url, url);
  assert.equal(item.thumbnail, "");
  assert.equal(X.normalize({ ...item, thumbnail: "https://evil.test/a.jpg" }, "artist"), null);
  const graph = { rest_id: "10", core: { user_results: { result: { core: { screen_name: "artist" } } } }, legacy: { entities: { media: [{ type: "video", video_info: { variants: [{ content_type: "video/mp4", url }] } }] } } };
  assert.equal(X.extract(graph, "artist")[0].url, url);
});

test("FxTwitter fallback validates the author and post and selects the highest quality MP4", () => {
  const url = "https://video.twimg.com/amplify_video/44/vid/1280x720/a.mp4";
  const payload = { tweet: { id: "10", author: { screen_name: "artist" }, media: { all: [{ id: "44", type: "video", thumbnail_url: "https://pbs.twimg.com/amplify_video_thumb/44/a.jpg", variants: [{ content_type: "video/mp4", bitrate: 500, url: "https://video.twimg.com/a.mp4" }, { content_type: "video/mp4", bitrate: 2000, url }] }] } } };
  assert.equal(X.extractFxTwitter(payload, "artist", "10")[0].url, url);
  assert.equal(X.extractFxTwitter(payload, "other", "10").length, 0);
  assert.equal(X.extractFxTwitter(payload, "artist", "11").length, 0);
  payload.tweet.media.all[0].variants = [{ content_type: "video/mp4", url: "https://evil.test/a.mp4" }];
  assert.equal(X.extractFxTwitter(payload, "artist", "10").length, 0);
});

test("Facebook selects a direct HD video and rejects non-CDN or segmented URLs", () => {
  assert.equal(FB.profile("https://web.facebook.com/artist/videos"), "artist");
  assert.equal(FB.videoId("https://www.facebook.com/artist/videos/123/"), "v123");
  assert.equal(FB.videoId("https://www.facebook.com/watch/?v=123"), "v123");
  const data = { __typename: "Video", id: "123", owner: { url: "https://www.facebook.com/artist", name: "Artist" }, browser_native_sd_url: "https://video.xx.fbcdn.net/v/small.mp4?sig=sd", browser_native_hd_url: "https://video.xx.fbcdn.net/v/big.mp4?sig=hd" };
  assert.equal(FB.videoOwner(data, "v123").handle, "artist");
  assert.equal(FB.videoOwner(data, "v124"), null);
  const items = FB.extract(data, "artist");
  assert.equal(items.length, 1);
  assert.equal(items[0].url, data.browser_native_hd_url);
  assert.equal(FB.filename(items[0]), "WakuDownload/Facebook/artist/123.mp4");
  assert.equal(FB.normalize({ ...items[0], url: "https://evil.test/big.mp4" }, "artist"), null);
  assert.equal(FB.normalize({ ...items[0], url: "https://video.xx.fbcdn.net/v/big.m3u8" }, "artist"), null);
});

test("Facebook Reel DASH chooses compatible video and audio tracks without losing signed parameters", () => {
  const xml = `<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation codecs="avc1.640028" bandwidth="200"><BaseURL>https://video.xx.fbcdn.net/high.mp4?a=1&amp;b=2</BaseURL></Representation><Representation codecs="avc1.640028" bandwidth="100"><BaseURL>https://video.xx.fbcdn.net/low.mp4?a=1&amp;b=2</BaseURL></Representation><Representation codecs="vp09.00.10.08" bandwidth="999"><BaseURL>https://video.xx.fbcdn.net/vp9.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation codecs="mp4a.40.2" bandwidth="128"><BaseURL>https://video.xx.fbcdn.net/audio.mp4?x=1&amp;y=2</BaseURL></Representation></AdaptationSet></Period></MPD>`;
  const result = FB.extract({ __typename: "Video", id: "123", dash_manifest: xml }, "artist");
  assert.equal(result[0].videoMode, "dash");
  assert.equal(result[0].url, "https://video.xx.fbcdn.net/high.mp4?a=1&b=2");
  assert.equal(result[0].audioUrl, "https://video.xx.fbcdn.net/audio.mp4?x=1&y=2");
  assert.equal(FB.normalize({ ...result[0], audioUrl: "https://evil.test/audio.mp4" }, "artist"), null);
  const modern = { __typename: "Video", videoId: "123", creation_story: { short_form_video_context: { video_owner: { id: "42", name: "Artist" }, playback_video: { videoDeliveryResponseFragment: { videoDeliveryResponseResult: { progressive_urls: [{ progressive_url: "https://video.xx.fbcdn.net/sd.mp4", metadata: { quality: "SD" } }, { progressive_url: "https://video.xx.fbcdn.net/hd.mp4", metadata: { quality: "HD" } }] } } } } } };
  assert.equal(FB.videoOwner(modern, "v123").handle, "42");
  assert.equal(FB.extract(modern, "42")[0].url, "https://video.xx.fbcdn.net/hd.mp4");
});

test("Pixiv validates animation metadata and preserves delays", () => {
  const item = { kind: "video", id: "123_ugoira", tweetId: "123", handle: "42", url: "https://i.pximg.net/img-zip-ugoira/img/2024/01/02/03/04/05/123_ugoira1920x1080.zip", frames: [{ file: "000000.jpg", delay: 100 }, { file: "000001.jpg", delay: 200 }] };
  const normalized = P.normalize(item, "42");
  assert.equal(normalized.frames[1].delay, 200);
  assert.equal(P.filename(normalized), "WakuDownload/Pixiv/42/123_ugoira.webm");
  assert.equal(P.normalize({ ...item, url: item.url.replace("123_ugoira", "999_ugoira") }, "42"), null);
  assert.equal(P.normalize({ ...item, frames: [{ file: "../../evil.jpg", delay: 100 }] }, "42"), null);
});
