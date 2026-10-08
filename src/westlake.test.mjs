import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseShare, isExpired, shareRequest, originalDownload } from "./westlake.js";

test("restrict share links to school HTTPS origin and extract hash links", () => {
  const id = "B4C62AC1615586A953161732B30A018F";
  assert.equal(parseShare(`https://pan.westlake.edu.cn:443/link/${id}`), id);
  assert.equal(parseShare(`https://pan.westlake.edu.cn/#/link/${id}`), id);
  for (const url of ["javascript:alert(1)", `https://evil.example/link/${id}`, `http://pan.westlake.edu.cn/link/${id}`]) assert.throws(() => parseShare(url));
});
test("expiration uses explicit Shanghai offset", () => {
  const album = { expiresAt: "2026-11-06T23:59:59+08:00" };
  assert.equal(isExpired(album, Date.parse("2026-11-06T15:59:58Z")), false);
  assert.equal(isExpired(album, Date.parse("2026-11-06T15:59:59Z")), true);
  assert.equal(isExpired({}), false);
});
test("requests keep passwords out of URLs and decode mislabeled JPEG bytes", async t => {
  let request;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, options };
    return new Response(new Uint8Array([255,216,255,224]), { headers: { "content-type": "application/json" } });
  });
  const blob = await shareRequest("id", "test-secret", "thumbnail", { docid: "gns://test" });
  assert.equal(blob.type, "image/jpeg");
  assert.equal(blob.size, 4);
  assert.equal(request.url.includes("test-secret"), false);
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.headers["Content-Type"], "text/plain;charset=UTF-8");
  assert.equal(JSON.parse(request.options.body).password, "test-secret");
});
test("failed unlock exposes a useful error", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ errcode: 401002 }), { status: 401 }));
  await assert.rejects(shareRequest("id", "wrong", "get"), /密码不正确/);
});
test("original download requests file bytes from signed school storage URL", async t => {
  let request;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return Response.json({ authrequest: ["GET", "https://driveoss.westlake.edu.cn:10002/westlake/file?signature=test"] });
  });
  const href = await originalDownload("id", "secret", { docid: "gns://photo", name: "照片.jpg" });
  assert.match(href, /^https:\/\/driveoss\.westlake\.edu\.cn:10002\//);
  assert.match(request.url, /method=osdownload$/);
  assert.equal(request.body.docid, "gns://photo");
  assert.equal(request.body.savename, "照片.jpg");
  assert.equal(request.body.usehttps, true);
});
test("download rejects unexpected destinations and unavailable permission", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ authrequest: ["GET", "https://evil.example/photo"] }));
  await assert.rejects(originalDownload("id", "secret", {}), /无法验证/);
  globalThis.fetch = async () => Response.json({ authrequest: [] });
  await assert.rejects(originalDownload("id", "secret", {}), /下载权限/);
});
test("public album metadata does not store a password or invented shooting date", async () => {
  const albums = JSON.parse(await readFile(new URL("../public/albums.json", import.meta.url), "utf8"));
  assert.equal(albums[0].date, "");
  for (const album of albums) { assert.equal("password" in album, false); parseShare(album.url); }
});
