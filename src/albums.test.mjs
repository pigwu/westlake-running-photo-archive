import test from "node:test";
import assert from "node:assert/strict";
import { albumPhotoName, albumFiles, latestRecords, sortAlbums, resolveAssignments, saveAlbum, assignPhotos, loadLibrary } from "./albums.js";
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
