import test from "node:test";
import assert from "node:assert/strict";
import { photoPreviewBlob } from "./photo-preview.js";

const session = { link: "fixture", password: "test" };
const file = { docid: "gns://photo", rev: "v1", name: "large.jpg", size: 30 * 1024 * 1024 };
const jpeg = new Uint8Array([255, 216, 255, 224]);
function mockStorage(t, thumbnailError = 403023) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    if (url.startsWith("https://driveoss")) return new Response(jpeg, { headers: { "content-type": "application/octet-stream" } });
    if (url.endsWith("method=thumbnail")) return thumbnailError ? Response.json({ errcode: thumbnailError }, { status: 403 }) : new Response(jpeg);
    assert.ok(url.endsWith("method=osdownload"));
    assert.equal(JSON.parse(options.body).docid, file.docid);
    return Response.json({ authrequest: ["GET", "https://driveoss.westlake.edu.cn/photo"] });
  });
  return calls;
}
test("oversized school previews fall back to a normalized original and resized preview", async t => {
  const calls = mockStorage(t); let notified = false;
  const result = await photoPreviewBlob(session, file, undefined, { onFallback: () => { notified = true; }, resize: async blob => {
    assert.equal(blob.type, "image/jpeg"); return new Blob(["small preview"], { type: "image/jpeg" });
  } });
  assert.equal(await result.text(), "small preview"); assert.ok(notified); assert.equal(calls.length, 3);
});
test("successful thumbnails never fetch originals", async t => {
  const calls = mockStorage(t, 0);
  assert.equal((await photoPreviewBlob(session, file)).type, "image/jpeg"); assert.equal(calls.length, 1);
});
test("permission failures and originals over the local preview budget do not trigger downloads", async t => {
  let calls = mockStorage(t, 403002);
  await assert.rejects(photoPreviewBlob(session, file), /操作权限/); assert.equal(calls.length, 1);
  calls = mockStorage(t);
  await assert.rejects(photoPreviewBlob(session, { ...file, size: 51 * 1024 * 1024 }), /下载原图/); assert.equal(calls.length, 1);
});
test("large original work is serial and a cancelled queued photo never downloads", async t => {
  const calls = mockStorage(t); const abort = new AbortController();
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const first = photoPreviewBlob(session, file, undefined, { resize: async blob => { entered(); await new Promise(resolve => { release = resolve; }); return blob; } });
  await ready;
  let queued; const queuedReady = new Promise(resolve => { queued = resolve; });
  const second = photoPreviewBlob(session, file, abort.signal, { onFallback: queued });
  const cancelled = assert.rejects(second, { name: "AbortError" });
  await queuedReady;
  assert.equal(calls.filter(url => url.endsWith("method=osdownload")).length, 1);
  abort.abort(); release(); await first; await cancelled;
  assert.equal(calls.filter(url => url.endsWith("method=osdownload")).length, 1);
  const next = await photoPreviewBlob(session, file, undefined, { resize: async blob => blob });
  assert.equal(next.type, "image/jpeg");
});
