import test from "node:test";
import assert from "node:assert/strict";
import { buildPeople, faceKey, indexedFaces, assertNoPhotoConflict } from "./people.js";
import { resolveReviews, validateReview, saveReview, loadReviews } from "./people-review.js";
import { faceIndexKey, referencePhotoIds, saveFaceIndex, loadFaceIndices, validateDiagnostics } from "./face-cache.js";
import { FACE_ENGINE } from "./sface-utils.js";
const root = `gns://${"A".repeat(32)}`, person = "a".repeat(32), avatar = "data:image/jpeg;base64,YQ==";
const photo = n => ({ docid: `${root}/${String(n).padStart(32,"0")}`, rev: "B".repeat(32), name: `synthetic-${n}.jpg` });
function face(n, degrees, p = photo(n), x = 0) {
  const theta = degrees * Math.PI / 180, value = { descriptor: [Math.cos(theta), Math.sin(theta), ...Array(126).fill(0)], box: [x,0,100,100], avatar };
  return { ...value, key: faceKey(p,value), photoId: p.docid, photoName:p.name };
}
const membership = result => result.groups.map(g => g.faces.map(f => f.key).sort()).sort((a,b) => a[0].localeCompare(b[0]));
test("global average-link merges groups and is invariant to all orders of the known counterexample", () => {
  const input = [face(1,0),face(2,70),face(3,35)];
  const permutations = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  const expected = membership(buildPeople(input,.5));
  assert.equal(expected.length,1);
  for (const order of permutations) assert.deepEqual(membership(buildPeople(order.map(i=>input[i]),.5)),expected);
});
test("global grouping respects same-photo and pairwise floor constraints after multiple merges", () => {
  const p = photo(1), input = [face(1,0,p),face(2,1,p,120),face(3,5),face(4,60),face(5,100)];
  const result = buildPeople(input,.1);
  for (const g of result.groups) {
    assert.equal(new Set(g.faces.map(f=>f.photoId)).size,g.faces.length);
    for (const a of g.faces) for(const b of g.faces) assert.ok(a.descriptor.reduce((s,v,i)=>s+v*b.descriptor[i],0)>=.1-1e-10);
  }
  assert.deepEqual(membership(result),membership(buildPeople([...input].reverse(),.1)));
});
test("manual confirmations survive threshold changes and block automatic re-merging after splits", () => {
  const input=[face(1,0),face(2,5),face(3,10)], other="b".repeat(32);
  const review={assignments:{[input[0].key]:person,[input[1].key]:person,[input[2].key]:other},names:{[person]:"确认甲",[other]:"确认乙"}};
  for (const threshold of [.1,.8]) {
    const result=buildPeople(input,threshold,review);
    assert.equal(result.groups.length,2); assert.equal(result.groups[0].name,"确认甲");
    assert.equal(result.groups[0].faces.length,2); assert.equal(result.groups[1].name,"确认乙");
  }
});

test("multiple confirmed views match a new face without diluting it by distant confirmed views", () => {
  const anchors = [face(1,0),face(2,5),face(3,-80)], query=face(4,55);
  const review={assignments:Object.fromEntries(anchors.map(f=>[f.key,person])),names:{[person]:"多视角人物"}};
  const input=[...anchors,query], result=buildPeople(input,.35,review);
  const g=result.groups.find(g=>g.id===person);
  assert.equal(g.faces.length,4);assert.equal(g.confirmedCount,3);assert.equal(g.suggestedCount,1);
  assert.equal(g.faces.find(f=>f.key===query.key).suggested,true);
  assert.equal(result.pending.length,0);
  assert.deepEqual(membership(result),membership(buildPeople([...input].reverse(),.35,review)));
  assert.equal(query.suggested,undefined);
});

test("one confirmed sample needs a strong match while moderate and ambiguous faces stay pending", () => {
  const a=face(1,0),high=face(2,20),moderate=face(3,55), other=face(4,90),middle=face(5,45), otherId="b".repeat(32);
  let result=buildPeople([a,high,moderate],.35,{assignments:{[a.key]:person},names:{}});
  assert.equal(result.groups.find(g=>g.id===person).suggestedCount,1);
  assert.ok(result.pending.some(f=>f.key===moderate.key));
  result=buildPeople([a,other,middle],.35,{assignments:{[a.key]:person,[other.key]:otherId},names:{}});
  assert.ok(result.groups.every(g=>g.suggestedCount===0));
  assert.match(result.pending.find(f=>f.key===middle.key).reason,/多个人物/);
});

test("automatically attached faces do not become anchors and cannot cause chain matches", () => {
  const a=face(1,0),b=face(2,20),near=face(3,60),far=face(4,100);
  const review={assignments:{[a.key]:person,[b.key]:person},names:{}};
  const result=buildPeople([a,b,near,far],.35,review),g=result.groups.find(g=>g.id===person);
  assert.ok(g.faces.some(f=>f.key===near.key));assert.ok(!g.faces.some(f=>f.key===far.key));
  assert.equal(g.confirmedCount,2);
  assert.deepEqual(membership(result),membership(buildPeople([far,near,b,a],.35,review)));
});

test("same-photo profile collisions stay pending and never fall through to another identity", () => {
  const anchor=face(1,0),query=face(2,2,photo(1),140);
  let result=buildPeople([anchor,query],.35,{assignments:{[anchor.key]:person},names:{}});
  assert.equal(result.groups[0].suggestedCount,0);assert.ok(result.pending.some(f=>f.key===query.key));
  const first=face(2,10,photo(2)),second=face(3,11,photo(2),140);
  result=buildPeople([anchor,first,second],.35,{assignments:{[anchor.key]:person},names:{}});
  assert.equal(result.groups[0].suggestedCount,0);assert.equal(result.pending.length,2);
  const weaker=face(3,40,photo(2),140);
  result=buildPeople([anchor,first,weaker],.35,{assignments:{[anchor.key]:person},names:{}});
  assert.equal(result.groups[0].suggestedCount,1);assert.equal(result.pending.length,1);
  assert.equal(new Set(result.groups[0].photos).size,result.groups[0].faces.length);
});

test("manual splits, ignored faces and rejected detections are never overridden by profile matching", () => {
  const a=face(1,0),b=face(2,1),ignored=face(3,2),rejected={...face(4,3),descriptor:undefined,reason:"人脸模糊"},other="b".repeat(32);
  const result=buildPeople([a,b,ignored,rejected],.35,{assignments:{[a.key]:person,[b.key]:other,[ignored.key]:"ignore"},names:{}});
  assert.equal(result.groups.length,2);assert.ok(result.groups.every(g=>g.faces.length===1));
  assert.equal(result.ignored.length,1);assert.equal(result.unrecognized.length,1);
});
test("manual same-photo conflicts are exposed rather than silently grouped", () => {
  const p=photo(1), input=[face(1,0,p),face(2,5,p,120)];
  assert.throws(()=>assertNoPhotoConflict(input),/同一张照片/);
  const result=buildPeople(input,.23,{assignments:Object.fromEntries(input.map(f=>[f.key,person])),names:{}});
  assert.equal(result.groups.length,0); assert.equal(result.conflicts.length,2);
});
test("ignored and rejected detections stay inspectable and manual assignment can include a rejected face", () => {
  const a=face(1,0), b={...face(2,50),descriptor:undefined,reason:"人脸模糊"};
  let result=buildPeople([a,b],.23,{assignments:{[a.key]:"ignore"},names:{}});
  assert.equal(result.groups.length,0); assert.equal(result.ignored.length,1); assert.equal(result.unrecognized.length,1);
  result=buildPeople([a,b],.23,{assignments:{[a.key]:person,[b.key]:person},names:{[person]:"手动归类"}});
  assert.equal(result.groups[0].photos.length,2);
});
test("candidates show mean and peak scores and exclude faces already present in the same photo", () => {
  const p=photo(1), a=face(1,0,p), b=face(2,10), pending=face(3,70), conflict=face(4,-70,p,130);
  const result=buildPeople([a,b,pending,conflict],.8,{assignments:{[a.key]:person,[b.key]:person},names:{[person]:"候选甲"}});
  const candidate=result.pending.find(f=>f.key===pending.key).candidates.find(c=>c.id===person);
  assert.ok(candidate.mean<candidate.peak); assert.equal(candidate.name,"候选甲");
  assert.ok(!result.pending.find(f=>f.key===conflict.key).candidates.some(c=>c.id===person));
});
test("face keys survive detection array reordering and change when original revision changes", () => {
  const p=photo(1), a=face(1,0,p),b=face(2,10,p,120);
  const first=indexedFaces([p],new Map([[faceIndexKey(p),[a,b]]]));
  const second=indexedFaces([p],new Map([[faceIndexKey(p),[b,a]]]));
  assert.deepEqual(first.map(f=>f.key),second.map(f=>f.key));
  assert.notEqual(faceKey(p,a),faceKey({...p,rev:"changed"},a));
});
test("shared corrections replay assign, ignore and undo in server order", () => {
  const a=face(1,0),b=face(2,10), records=[
    {action:"reset",faceKeys:[a.key],file:{create_time:3,name:"reset"}},
    {action:"assign",faceKeys:[a.key,b.key],personId:person,name:"新名称",file:{create_time:1,name:"assign"}},
    {action:"ignore",faceKeys:[b.key],file:{create_time:2,name:"ignore"}},
  ];
  const result=resolveReviews(records); assert.equal(result.assignments[a.key],undefined); assert.equal(result.assignments[b.key],"ignore"); assert.equal(result.names[person],"新名称");
});
test("review validation rejects foreign roots, malformed keys and oversized batches", () => {
  const record={version:1,albumId:"legacy",action:"assign",personId:person,name:"test",faceKeys:[face(1,0).key]};
  assert.equal(validateReview(record,root,"legacy"),record);
  assert.throws(()=>validateReview(record,"gns://foreign","legacy"));
  assert.throws(()=>validateReview({...record,faceKeys:["invalid"]},root,"legacy"));
  assert.throws(()=>validateReview({...record,faceKeys:Array(501).fill(record.faceKeys[0])},root,"legacy"));
  assert.throws(()=>validateReview({...record,personId:"auto:unstable"},root,"legacy"));
});
test("shared correction save and fresh-client load preserve name and assignment without overwriting", async t => {
  const session={link:"share",password:"test"}, p=photo(1), f=face(1,0,p); let saved, stored;
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    if(url.startsWith("https://driveoss"))return Response.json(saved);
    const body=JSON.parse(options.body);
    if(url.includes("method=get"))return Response.json({docid:root,size:-1,perm:7});
    if(url.includes("method=listdir"))return Response.json({files:[stored],dirs:[]});
    if(url.includes("method=osbeginupload")){assert.equal(body.ondup,1);stored={name:body.name,docid:root+"/meta",size:100,create_time:1};return Response.json({...stored,rev:"r",authrequest:["POST","https://driveoss.westlake.edu.cn/file"]});}
    if(url.includes("method=osdownload"))return Response.json({authrequest:["GET","https://driveoss.westlake.edu.cn/file"]});
    return Response.json({});
  });
  await saveReview(session,root,"legacy",{action:"assign",personId:person,name:"确认组",faceKeys:[f.key]},{transfer:async transport=>{saved=JSON.parse(await transport.body.get("file").text());}});
  const result=await loadReviews(session,root,"legacy");assert.equal(result.assignments[f.key],person);assert.equal(result.names[person],"确认组");
});
test("a failed review read is surfaced instead of treating manual decisions as absent", async t=>{
  t.mock.method(globalThis,"fetch",async url=>url.includes("osdownload")?Response.json({authrequest:["GET","https://driveoss.westlake.edu.cn/file"]}):new Response("",{status:503}));
  await assert.rejects(loadReviews({link:"share"},root,"legacy",undefined,[{name:`__run_people_v1_legacy_${person}.json`,size:100,docid:root+"/meta"}]),/读取失败/);
});
test("ignored detections are excluded from reference search",()=>{
  const p=photo(1),f=face(1,0,p),indices=new Map([[faceIndexKey(p),[f]]]);
  assert.deepEqual(referencePhotoIds([f],indices,[p],.23,new Set([f.key])),[]);
});
test("new diagnostics round-trip while old v3 feature indices remain compatible",async t=>{
  const p=photo(1),f=face(1,0,p),session={link:"share"};let saved,stored;
  const detail={version:1,totalDetected:2,accepted:1,rejected:[{box:[120,0,20,20],avatar,reason:"人脸太小"}]};
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    if(url.startsWith("https://driveoss"))return Response.json(saved);
    const body=JSON.parse(options.body);
    if(url.includes("osbeginupload")){stored={name:body.name,docid:root+"/meta",size:100,create_time:1};return Response.json({...stored,rev:"r",authrequest:["POST","https://driveoss.westlake.edu.cn/file"]});}
    if(url.includes("listdir"))return Response.json({files:[stored],dirs:[]});
    if(url.includes("osdownload"))return Response.json({authrequest:["GET","https://driveoss.westlake.edu.cn/file"]});
    return Response.json({});
  });
  await saveFaceIndex(session,root,p,[f],{diagnostics:detail,transfer:async transport=>{saved=JSON.parse(await transport.body.get("file").text());}});
  let data=await loadFaceIndices(session,root,[p]);assert.deepEqual(data.diagnostics.get(faceIndexKey(p)),detail);
  delete saved.diagnostics;data=await loadFaceIndices(session,root,[p]);assert.equal(data.indices.size,1);assert.equal(data.diagnostics.size,0);assert.equal(saved.engine,FACE_ENGINE);
  assert.throws(()=>validateDiagnostics({...detail,accepted:2},1));
});
