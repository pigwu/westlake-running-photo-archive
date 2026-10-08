import test from "node:test";
import assert from "node:assert/strict";
import { faceTiles, deduplicateFaces, boundedFaceCrop, groupDetectedFaces } from "./face-utils.js";
import { analyzePhoto, detectOriginalFaces, describeDetectedFaces } from "./faces.js";
import { faceIndexKey, validateFaceIndex, referencePhotoIds, saveFaceIndex, loadFaceIndices } from "./face-cache.js";
import { originalPhotoBlob } from "./westlake.js";
import { uploadPhotoWithIndex } from "./upload-index.js";
import { normalizeImageBlob, loadAnalysisImage } from "./image-input.js";

test("overlapping original tiles cover all edges and cap processing work", () => {
  for (const [width, height] of [[6048,4024],[1000,800],[40000,20000]]) {
    const tiles = faceTiles(width, height);
    assert.ok(tiles.length <= 36);
    assert.ok(tiles.some(t=>t.x===0 && t.y===0));
    assert.ok(tiles.some(t=>t.x+t.width===width && t.y+t.height===height));
    for (const t of tiles) assert.ok(t.x>=0 && t.y>=0 && t.x+t.width<=width && t.y+t.height<=height);
  }
});
test("deduplication removes overlapping tile detections but keeps adjacent faces", () => {
  const boxes = [{x:10,y:20,width:100,height:100,score:.9},{x:15,y:25,width:96,height:96,score:.7},{x:120,y:20,width:100,height:100,score:.8}];
  assert.deepEqual(deduplicateFaces(boxes), [boxes[0],boxes[2]]);
  assert.deepEqual(boundedFaceCrop({x:0,y:0,width:100,height:80},110,90), {x:0,y:0,width:110,height:90});
});
test("different detections in the same photo never collapse into one group", () => {
  const groups = [];
  const faces = [{descriptor:[.1,.2],avatar:"a"},{descriptor:[.11,.2],avatar:"b"}];
  groupDetectedFaces(groups,faces,"photo-one");
  assert.equal(groups.length,2);
  groupDetectedFaces(groups,[{descriptor:[.105,.2],avatar:"c"}],"photo-two");
  assert.equal(groups.length,2); assert.equal(groups[0].photos.length,2);
});
test("stop is honored before loading or decoding any original or models", async () => {
  const signal = AbortSignal.abort();
  for (const promise of [analyzePhoto({url:"invalid"},{signal}),detectOriginalFaces({}, {signal}),describeDetectedFaces({}, [], {signal})]) await assert.rejects(promise,{name:"AbortError"});
});
test("index validation binds cached vectors to the exact photo revision", () => {
  const file={docid:"gns://root/photo",rev:"one"};
  const face={descriptor:Array(128).fill(.1),box:[0,0,100,100],avatar:"data:image/jpeg;base64,AA=="};
  const record={version:2,...file,faces:[face]};
  assert.equal(validateFaceIndex(record,file).length,1);
  assert.throws(()=>validateFaceIndex(record,{...file,rev:"two"}));
  assert.throws(()=>validateFaceIndex({...record,faces:[{...face,descriptor:[1,2]}]},file));
});
test("reference matching uses saved synthetic vectors and returns all matching photo ids", () => {
  const photos=[{docid:"one",rev:"r"},{docid:"two",rev:"r"},{docid:"three",rev:"r"}];
  const indices=new Map([[faceIndexKey(photos[0]),[{descriptor:[0,0]},{descriptor:[2,2]}]],[faceIndexKey(photos[1]),[{descriptor:[.1,.1]}]]]);
  assert.deepEqual(referencePhotoIds([{descriptor:[.05,.05]}],indices,photos),["one","two"]);
});
test("original analysis downloads signed original bytes with cancellation and no thumbnail request", async t => {
  const urls=[];const signal=new AbortController().signal;
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    urls.push(url);assert.equal(options.signal,signal);
    if(url.includes("method=osdownload")) return Response.json({authrequest:["GET","https://driveoss.westlake.edu.cn/original"]});
    return new Response(new Uint8Array([255,216,255]), { headers: { "Content-Type": "application/octet-stream" } });
  });
  const blob=await originalPhotoBlob({link:"test",password:"secret"},{docid:"photo",name:"a.jpg",size:3},signal);
  assert.equal(blob.size,3);assert.equal(blob.type,"image/jpeg");assert.equal(urls.length,2);assert.ok(urls.every(url=>!url.includes("thumbnail")));
});

test("image bytes override generic, missing or incorrect MIME types without changing pixels", async () => {
  const samples = [["image/jpeg",[255,216,255,224]], ["image/png",[137,80,78,71,13,10,26,10]],
    ["image/gif",Array.from(new TextEncoder().encode("GIF89a"))],
    ["image/webp",Array.from(new TextEncoder().encode("RIFF1234WEBP"))]];
  for (const [type, bytes] of samples) for (const declaredType of ["application/octet-stream", "", "application/json"]) {
    const normalized = await normalizeImageBlob(new Blob([new Uint8Array(bytes)], {type:declaredType}));
    assert.equal(normalized.type,type);
    assert.deepEqual(new Uint8Array(await normalized.arrayBuffer()),new Uint8Array(bytes));
  }
  await assert.rejects(normalizeImageBlob(new Blob(["<html>error</html>"],{type:"image/jpeg"})), /不是支持的图片/);
});

test("image loading stops before fetching when cancelled", async () => {
  await assert.rejects(loadAnalysisImage("invalid",AbortSignal.abort()),{name:"AbortError"});
});
test("shared index can be saved and read by another client without running inference", async t => {
  const root="gns://"+"A".repeat(32), file={docid:root+"/"+"B".repeat(32),rev:"C".repeat(32),name:"a.jpg"};
  const session={link:"share",password:"test"};let record,indexName;
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    if(url.startsWith("https://driveoss"))return Response.json(record);
    const body=JSON.parse(options.body);
    if(url.includes("osbeginupload")){indexName=body.name;assert.equal(body.docid,root);return Response.json({docid:root+"/"+"D".repeat(32),rev:"E".repeat(32),authrequest:["POST","https://driveoss.westlake.edu.cn/index"]});}
    if(url.includes("listdir"))return Response.json({files:[{name:indexName,docid:root+"/index",size:100,create_time:10}],dirs:[]});
    if(url.includes("osdownload"))return Response.json({authrequest:["GET","https://driveoss.westlake.edu.cn/index"]});
    return Response.json({});
  });
  await saveFaceIndex(session,root,file,[],{transfer:async transport=>{record=JSON.parse(await transport.body.get("file").text());}});
  const data=await loadFaceIndices(session,root,[file]);
  assert.ok(data.indices.has(faceIndexKey(file)));assert.deepEqual(data.indices.get(faceIndexKey(file)),[]);
  assert.equal(data.warnings.length,0);assert.equal("password" in record,false);
});
test("index failure after upload still reports saved original and never retransmits it", async t => {
  let transfers=0,stored=false;
  t.mock.method(globalThis,"fetch",async(url)=> url.includes("osbeginupload") ? Response.json({docid:"gns://root/photo",rev:"r",authrequest:["POST","https://driveoss.westlake.edu.cn/file"]}) : Response.json({}));
  const result=await uploadPhotoWithIndex({link:"share",password:"test"},"gns://root","gns://root",new File(["photo"],"test.jpg"),"test.jpg",{
    transfer:async()=>{transfers++;},onPhotoStored:()=>{stored=true;},analyze:async()=>{throw new Error("test model failure");},
  });
  assert.equal(transfers,1);assert.equal(stored,true);assert.equal(result.indexed,false);
  assert.equal(result.stored.docid,"gns://root/photo");assert.match(result.indexError,/test model failure/);
});
