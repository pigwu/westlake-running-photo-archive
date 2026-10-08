import test from "node:test";
import assert from "node:assert/strict";
import { uploadName, photoLabel, uploadTransport, uploadPhoto } from "./upload.js";

const file = new File([new Uint8Array([1, 2, 3])], "合影.jpg", { type: "image/jpeg", lastModified: 1700000000000 });
test("activity and date travel with photo name for all viewers", () => {
  const name = uploadName(file, "2026-10-08", "秋日晨跑");
  assert.deepEqual(photoLabel(name), { date: "2026-10-08", activity: "秋日晨跑", originalName: "合影.jpg" });
  assert.deepEqual(photoLabel("old.jpg"), { date: "", activity: "", originalName: "old.jpg" });
  for (const date of ["2026-02-30", "invalid"]) assert.throws(() => uploadName(file, date, "晨跑"));
  for (const activity of ["", "../目录", "a_b"]) assert.throws(() => uploadName(file, "2026-10-08", activity));
  assert.throws(() => uploadName(new File(["script"], "script.html"), "2026-10-08", "晨跑"));
});
test("signed POST upload fields match school transport and contain original file", async () => {
  const request = uploadTransport(["POST", "https://driveoss.westlake.edu.cn:10002/upload", "key: photos/name.jpg", "policy: a: b", "Date: ignored"], file);
  assert.equal(request.method, "POST");
  assert.equal(request.body.get("policy"), "a: b");
  assert.equal(request.body.has("Date"), false);
  assert.deepEqual(new Uint8Array(await request.body.get("file").arrayBuffer()), new Uint8Array([1,2,3]));
  assert.throws(() => uploadTransport(["POST", "http://driveoss.westlake.edu.cn/photo"], file));
  assert.throws(() => uploadTransport(["POST", "https://evil.example/photo"], file));
});
test("uploads check duplicates and finalize only after original bytes succeed", async t => {
  const calls=[];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const method=new URL(url).searchParams.get("method"); const payload=JSON.parse(options.body); calls.push({method,payload});
    return Response.json(method === "osbeginupload" ? { docid:"gns://new", rev:"revision", authrequest:["POST","https://driveoss.westlake.edu.cn/upload"] } : { name:"stored.jpg" });
  });
  const result=await uploadPhoto({link:"id",password:"secret"},"gns://folder",file,"tagged.jpg",{transfer:async () => { calls.push({method:"transfer"}); }});
  assert.deepEqual(calls.map(c=>c.method),["osbeginupload","transfer","osendupload"]);
  assert.equal(calls[0].payload.ondup,1);
  assert.equal(calls[0].payload.client_mtime,1700000000000000);
  assert.equal(result.docid,"gns://new");
  calls.length=0;
  await assert.rejects(uploadPhoto({link:"id",password:"secret"},"gns://folder",file,"tagged.jpg",{transfer:async()=>{throw new Error("network failure");}}), /network failure/);
  assert.deepEqual(calls.map(c=>c.method),["osbeginupload"]);
});
