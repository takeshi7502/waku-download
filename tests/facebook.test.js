import test from "node:test";
import assert from "node:assert/strict";
import "../extension/src/platforms/facebook.js";
const { profile, isPhotos, photo, photoId, normalize, extract, filename } = globalThis.WakuFacebook;
const signed = "https://scontent-lga3-3.xx.fbcdn.net/v/t39.30808-6/abc_n.jpg?stp=large&_nc_cat=1&oh=abc%2Bdef&oe=123";

test("identifies numeric and named Facebook photo profiles", () => {
  assert.equal(profile("https://web.facebook.com/profile.php?id=100075970176818&sk=photos"), "100075970176818");
  assert.equal(profile("https://www.facebook.com/name.example/photos"), "name.example");
  assert.equal(isPhotos("https://web.facebook.com/profile.php?id=100075970176818&sk=photos"), true);
  assert.equal(isPhotos("https://www.facebook.com/name.example/photos_by"), true);
  assert.equal(isPhotos("https://facebook.com/name.example"), false);
  for (const url of ["https://facebook.com/profile.php?id=../x&sk=photos", "https://facebook.com/groups/123/photos", "https://facebook.com/photo/?fbid=123", "https://facebook.com.evil.com/test/photos", "http://facebook.com/name/photos"]) assert.equal(profile(url), null, url);
});
test("preserves signed photo URLs and only accepts Facebook CDN image paths", () => {
  assert.equal(photo(signed).url, signed);
  assert.equal(photoId("https://web.facebook.com/photo.php?fbid=123&set=a.1"), "123");
  assert.equal(photoId("https://www.facebook.com/example/photos/a.12/345/"), "345");
  assert.equal(photoId("https://www.facebook.com/photo/?fbid=../123"), null);
  for (const url of ["https://evil.com/v/photo.jpg", "https://fbcdn.net.evil.com/v/a.jpg", "https://fbcdn.net/v/a.mp4", "https://fbcdn.net/v/a.html", "http://fbcdn.net/v/a.jpg", "https://fbcdn.net:444/v/a.jpg"]) assert.equal(photo(url), null, url);
  const item = normalize({ id: "123", handle: "100075970176818", url: signed }, "100075970176818");
  assert.equal(filename(item), "WakuDownload/Facebook/100075970176818/123.jpg");
  assert.equal(normalize({ ...item, handle: "another" }, "100075970176818"), null);
});
test("extracts photo media and picks the largest supplied signed URL without including video", () => {
  const small = "https://scontent.xx.fbcdn.net/v/t39/a_n.jpg?stp=small&oh=thumb";
  const data = { data: { nodes: [
    { __typename: "Photo", legacy_fbid: "123", photo_image: { uri: signed, width: 1200, height: 1800 }, thumbnail: { uri: small, width: 100, height: 150 }, creation_time: "not-a-time" },
    { __isMedia: "Photo", id: "opaque", url: "https://facebook.com/photo/?fbid=456", image: { uri: small, width: 100, height: 150 } },
    { __typename: "Video", id: "789", photo_image: { uri: signed, width: 2000, height: 2000 } }
  ] } };
  const items = extract(data, "100075970176818");
  assert.equal(items.length, 2);
  assert.equal(items.find(item => item.id === "123").url, signed);
  assert.equal(items.find(item => item.id === "123").date, "");
  assert.equal(items.find(item => item.id === "456").url, small);
});
