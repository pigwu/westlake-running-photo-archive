import test from "node:test";
import assert from "node:assert/strict";
import { albumPhotoName, albumFiles, latestRecords, sortAlbums, resolveAssignments, resolveVisibility, setPhotosDeleted, saveAlbum, assignPhotos, loadLibrary } from "./albums.js";
import { photoLabel } from "./upload.js";

const a = "a".repeat(32), b = "b".repeat(32);
const file = { name: "合影.jpg", size: 100 };
test("photos in the same drive folder stay in separate logical albums", () => {
  const name = albumPhotoName(file, "2026-10-08", "", a);
  const files = [{ name, docid: "one" }, { name: albumPhotoName(file, "2026-10-08", "夜跑", b), docid: "two" }, { name: "old.jpg", docid: "old" }];
  assert.deepEqual(albumFiles(files, a).map(f => f.docid), ["one"]);
  assert.deepEqual(albumFiles(files, b).map(f => f.docid), ["two"]);
  assert.deepEqual(albumFiles(files, "legacy").map(f => f.docid), ["old"]);
  assert.deepEqual(photoLabel(name), { date: "2026-10-08", activity: "", originalName: "合影.jpg" });
});

test("delete/restore records replay in server order and preserve album memberships", () => {
  const files = [{ name: "old.jpg", docid: "one" }, { name: "other.jpg", docid: "two" }];
  const changes = [
    { deleted: false, docids: ["one"], file: { create_time: 30, name: "restore" } },
    { deleted: true, docids: ["one", "two"], file: { create_time: 20, name: "delete" } },
  ];
  const visibility = resolveVisibility(changes);
  const assignments = { one: a, two: b };
  assert.equal(albumFiles(files, a, assignments, visibility)[0].docid, "one");
  assert.equal(albumFiles(files, b, assignments, visibility).length, 0);
  assert.equal(albumFiles(files, b, assignments, visibility, true)[0].docid, "two");
  assert.equal(albumFiles(files, a, assignments, visibility, true).length, 0);
  // Tied server timestamps use the same deterministic filename ordering on every client.
  assert.equal(resolveVisibility([
    { deleted: false, docids: ["one"], file: { create_time: 20, name: "z" } },
    { deleted: true, docids: ["one"], file: { create_time: 20, name: "a" } },
  ]).one, false);
});

test("deletion is append-only, deduplicates selections and never calls file/delete", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    if (url.includes("method=get")) return Response.json({ size: -1, perm: 7, docid: "gns://root" });
    if (url.includes("method=listdir")) return Response.json({ files: [{ name: "sample.jpg", docid: "gns://root/photo" }], dirs: [] });
    if (url.includes("method=osbeginupload")) return Response.json({ docid: "gns://root/meta", rev: "rev", authrequest: ["POST", "https://driveoss.westlake.edu.cn/object"] });
    return Response.json({});
  });
  let saved;
  await setPhotosDeleted({ url: `https://pan.westlake.edu.cn/link/${a}` }, ["gns://root/photo", "gns://root/photo"], true, {
    transfer: async transport => { saved = JSON.parse(await transport.body.get("file").text()); },
  });
  assert.deepEqual(saved, { version: 1, deleted: true, docids: ["gns://root/photo"] });
  assert.deepEqual(calls.map(c => new URL(c.url).searchParams.get("method")), ["get", "listdir", "osbeginupload", "osendupload"]);
  assert.equal(calls[2].body.ondup, 1);
  assert.match(calls[2].body.name, /^__run_visibility_v1_[a-f0-9]{32}\.json$/);
});

test("deletion refuses missing files, metadata, foreign folders, invalid batches and read-only shares", async t => {
  let perm = 7, uploads = 0;
  const source = { url: `https://pan.westlake.edu.cn/link/${a}` };
  t.mock.method(globalThis, "fetch", async url => {
    if (url.includes("method=get")) return Response.json({ size: -1, perm, docid: "gns://root" });
    if (url.includes("method=listdir")) return Response.json({ files: [{ name: "index.json", docid: "gns://root/meta" }], dirs: [] });
    uploads++; throw new Error("Unexpected upload");
  });
  await assert.rejects(setPhotosDeleted(source, ["gns://other/photo"], true), /记录无效/);
  await assert.rejects(setPhotosDeleted(source, ["gns://root/meta"], true), /已不存在/);
  await assert.rejects(setPhotosDeleted(source, ["gns://root/missing"], true), /已不存在/);
  await assert.rejects(setPhotosDeleted(source, [], true), /记录无效/);
  await assert.rejects(setPhotosDeleted(source, Array.from({ length: 101 }, (_, i) => `gns://root/${i}`), true), /记录无效/);
  await assert.rejects(setPhotosDeleted(source, ["gns://root/photo"], "yes"), /记录无效/);
  perm = 3;
  await assert.rejects(setPhotosDeleted(source, ["gns://root/photo"], true), /权限/);
  assert.equal(uploads, 0);
});

test("fresh clients synchronise recycled counts and restoration from shared records", async t => {
  const files = [
    { name: `__run_visibility_v1_${a}.json`, docid: "gns://root/delete", size: 100, create_time: 20 },
    { name: "first.jpg", docid: "gns://root/first", size: 100 },
    { name: "second.png", docid: "gns://root/second", size: 100 },
  ];
  let malformed = false;
  const metadata = {
    delete: { version: 1, deleted: true, docids: ["gns://root/first", "gns://root/second"] },
    restore: { version: 1, deleted: false, docids: ["gns://root/first"] },
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.startsWith("https://driveoss")) return Response.json(malformed ? { version: 1, deleted: true, docids: ["gns://foreign/first"] } : metadata[url.split("/").at(-1)]);
    const body = JSON.parse(options.body);
    if (url.includes("method=get")) return Response.json({ size: -1, perm: 7, docid: "gns://root" });
    if (url.includes("method=listdir")) return Response.json({ files, dirs: [] });
    return Response.json({ authrequest: ["GET", `https://driveoss.westlake.edu.cn/${body.docid.split("/").at(-1)}`] });
  });
  const sources = [{ id: "root", title: "活动", url: `https://pan.westlake.edu.cn/link/${a}` }];
  const deleted = (await loadLibrary(sources))[0];
  assert.equal(deleted.photoCount, 0); assert.equal(deleted.recycledCount, 2);
  files.push({ name: `__run_visibility_v1_${b}.json`, docid: "gns://root/restore", size: 100, create_time: 30 });
  const restored = (await loadLibrary(sources))[0];
  assert.equal(restored.photoCount, 1); assert.equal(restored.recycledCount, 1);
  assert.equal(albumFiles(files, "legacy", restored.assignments, restored.visibility)[0].docid, "gns://root/first");
  malformed = true;
  await assert.rejects(loadLibrary(sources), /记录无效/);
});

test("recycling checks photos in subfolders and writes the shared record to the root", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ method: new URL(url).searchParams.get("method"), body });
    if (url.includes("method=get")) return Response.json({ size: -1, perm: 7, docid: "gns://root" });
    if (url.includes("method=listdir")) return Response.json({ dirs: [], files: [{ name: "synthetic.jpg", docid: body.docid + "/photo" }] });
    if (url.includes("method=osbeginupload")) return Response.json({ docid: "gns://root/meta", rev: "rev", authrequest: ["POST", "https://driveoss.westlake.edu.cn/object"] });
    return Response.json({});
  });
  await setPhotosDeleted({ url: `https://pan.westlake.edu.cn/link/${a}` }, ["gns://root/photo", "gns://root/sub/photo"], false, { transfer: async () => {} });
  assert.deepEqual(calls.filter(c => c.method === "listdir").map(c => c.body.docid).sort(), ["gns://root", "gns://root/sub"]);
  assert.equal(calls.find(c => c.method === "osbeginupload").body.docid, "gns://root");
});

test("failed transfer does not finalize a deletion record", async t => {
  let finalized = false;
  t.mock.method(globalThis, "fetch", async url => {
    if (url.includes("method=get")) return Response.json({ size: -1, perm: 7, docid: "gns://root" });
    if (url.includes("method=listdir")) return Response.json({ dirs: [], files: [{ name: "sample.jpg", docid: "gns://root/photo" }] });
    if (url.includes("method=osbeginupload")) return Response.json({ docid: "gns://root/meta", rev: "rev", authrequest: ["POST", "https://driveoss.westlake.edu.cn/object"] });
    finalized = true; return Response.json({});
  });
  await assert.rejects(setPhotosDeleted({ url: `https://pan.westlake.edu.cn/link/${a}` }, ["gns://root/photo"], true, { transfer: async () => { throw new Error("模拟传输失败"); } }), /模拟传输失败/);
  assert.equal(finalized, false);
});
test("assignment changes old and new photo albums without changing files", () => {
  const files = [{ name: "old.jpg", docid: "old" }, { name: albumPhotoName(file, "2026-10-08", "", a), docid: "one" }];
  const assignments = resolveAssignments([
    { albumId: b, docids: ["old", "one"], file: { create_time: 20, name: "later" } },
    { albumId: a, docids: ["old"], file: { create_time: 10, name: "earlier" } },
  ]);
  assert.deepEqual(albumFiles(files, b, assignments).map(f => f.docid), ["old", "one"]);
  assert.equal(albumFiles(files, a, assignments).length, 0);
  assert.equal(files[0].name, "old.jpg");
});
test("newest server record wins a rename, while creation order stays unchanged", () => {
  const files = [
    { name: `__run_album_v1_${a}_${b}.json`, create_time: 10 },
    { name: `__run_album_v1_${a}_${a}.json`, create_time: 20 },
    { name: "unrelated.json", create_time: 30 },
  ];
  assert.equal(latestRecords(files)[0][1], files[1]);
  assert.deepEqual(sortAlbums([{ id: a, title: "刚改名", createdAt: "2026-10-01" }, { id: b, title: "最新活动", createdAt: "2026-10-08" }]).map(v => v.id), [b, a]);
});
test("saving album metadata is append-only and preserves id and creation time on rename", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    if (url.includes("method=get")) return Response.json({ size: -1, perm: 7, docid: "gns://root" });
    if (url.includes("method=osbeginupload")) return Response.json({ docid: "gns://root/meta", rev: "rev", authrequest: ["POST", "https://driveoss.westlake.edu.cn/object"] });
    return Response.json({});
  });
  let record;
  const source = { id: "root", url: `https://pan.westlake.edu.cn/link/${a}`, accessPassword: "test" };
  const existing = { albumId: a, createdAt: "2026-10-01T00:00:00Z" };
  const result = await saveAlbum(source, "新名字", "2026-10-08", existing, { transfer: async transport => { record = JSON.parse(await transport.body.get("file").text()); } });
  assert.equal(result, `root:${a}`);
  assert.equal(record.title, "新名字"); assert.equal(record.createdAt, existing.createdAt); assert.equal(record.id, a);
  assert.equal(calls[1].body.ondup, 1);
  assert.match(calls[1].body.name, new RegExp(`^__run_album_v1_${a}_[a-f0-9]{32}\\.json$`));
});
test("classification refuses photos outside the configured shared folder", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ size: -1, perm: 7, docid: "gns://root" }));
  await assert.rejects(assignPhotos({ url: `https://pan.westlake.edu.cn/link/${a}` }, a, ["gns://other/photo"]), /不属于/);
});
test("fresh clients reconstruct names, memberships and latest ordering from shared drive records", async t => {
  const files = [
    { name: `__run_album_v1_${a}_${a}.json`, docid: "gns://root/album", size: 100, create_time: 20 },
    { name: `__run_album_v1_${b}_${b}.json`, docid: "gns://root/hidden", size: 100, create_time: 25 },
    { name: `__run_assignment_v1_${b}.json`, docid: "gns://root/move", size: 100, create_time: 30 },
    { name: "old.jpg", docid: "gns://root/photo", size: 100 },
  ];
  const metadata = {
    album: { version: 1, id: a, title: "夜跑改名", date: "2026-10-08", createdAt: "2026-10-08T12:00:00Z" },
    hidden: { version: 1, id: b, title: "已归档测试", date: "", createdAt: "2026-10-08T13:00:00Z", archived: true },
    move: { version: 1, albumId: a, docids: ["gns://root/photo"] },
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.startsWith("https://driveoss")) return Response.json(metadata[url.split("/").at(-1)]);
    const body = JSON.parse(options.body);
    if (url.includes("method=get")) return Response.json({ size: -1, perm: 7, docid: "gns://root" });
    if (url.includes("method=listdir")) return Response.json({ files, dirs: [] });
    return Response.json({ authrequest: ["GET", `https://driveoss.westlake.edu.cn/${body.docid.split("/").at(-1)}`] });
  });
  const result = await loadLibrary([{ id: "root", title: "原有照片", url: `https://pan.westlake.edu.cn/link/${a}` }]);
  assert.equal(result.length, 2); assert.equal(result[0].title, "夜跑改名"); assert.equal(result[0].photoCount, 1);
  assert.equal(result[1].albumId, "legacy"); assert.equal(result[1].photoCount, 0);
});
