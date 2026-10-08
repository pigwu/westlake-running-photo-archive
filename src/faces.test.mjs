import test from "node:test";
import assert from "node:assert/strict";
import { faceTiles, deduplicateFaces, boundedFaceCrop } from "./face-utils.js";
import { buildPeople } from "./people.js";
import { analyzePhoto, detectOriginalFaces, describeDetectedFaces, prepareFaceAnalysis } from "./faces.js";
import { faceIndexKey, validateFaceIndex, referencePhotoIds, saveFaceIndex, loadFaceIndices, needsFaceDetailsUpdate } from "./face-cache.js";
import { originalPhotoBlob } from "./westlake.js";
import { uploadPhotoWithIndex } from "./upload-index.js";
import { normalizeImageBlob, loadAnalysisImage } from "./image-input.js";
import { FACE_ENGINE, ALIGN_POINTS, planarPixels, similarityTransform, decodeYuNet, faceQualityReason, normalizeDescriptor, normalizeMatchThreshold, restoreMatchThreshold } from "./sface-utils.js";

// Feed the complete synthetic set through the production global grouper.
function groupDetectedFaces(groups, faces, photoId, threshold) {
  const all = [...groups.flatMap(g => g.faces), ...faces.map((face, i) => ({ ...face, key: `${photoId}|${i}`, photoId }))];
  groups.splice(0, groups.length, ...buildPeople(all, threshold).groups);
  return groups;
}

test("ONNX inputs retain raw pixel values in the model's expected channel order", () => {
  const rgba=new Uint8ClampedArray([10,20,30,255,40,50,60,255]);
  assert.deepEqual(Array.from(planarPixels(rgba,2,1,"RGB")),[10,40,20,50,30,60]);
  assert.deepEqual(Array.from(planarPixels(rgba,2,1,"BGR")),[30,60,20,50,10,40]);
});
test("five-point alignment restores a known rotation, scale and translation", () => {
  const points=ALIGN_POINTS.map(([x,y])=>[2*(.8*x-.6*y)+31,2*(.6*x+.8*y)-17]);
  const [a,b,c,d,e,f]=similarityTransform(points);
  points.forEach(([x,y],i)=>{
    assert.ok(Math.abs(a*x+c*y+e-ALIGN_POINTS[i][0])<1e-6);
    assert.ok(Math.abs(b*x+d*y+f-ALIGN_POINTS[i][1])<1e-6);
  });
  assert.throws(()=>similarityTransform(Array(5).fill([1,1])));
});
test("YuNet decodes grid boxes, landmarks and joint confidence", () => {
  const outputs={};
  for(const stride of[8,16,32])for(const [key,width] of[["cls",1],["obj",1],["bbox",4],["kps",10]])outputs[`${key}_${stride}`]={data:new Float32Array((64/stride)**2*width)};
  const i=10; outputs.cls_8.data[i]=.81;outputs.obj_8.data[i]=1;
  outputs.bbox_8.data.set([.5,.5,Math.log(2),Math.log(3)],i*4);
  outputs.kps_8.data.set([0,0,1,0,.5,.5,0,1,1,1],i*10);
  const faces=decodeYuNet(outputs,64);
  assert.equal(faces.length,1);assert.ok(Math.abs(faces[0].score-.9)<1e-6);
  assert.ok(Math.abs(faces[0].x-12)<1e-6);assert.ok(Math.abs(faces[0].y)<1e-6);
  assert.deepEqual(faces[0].landmarks,[[16,8],[24,8],[20,12],[16,16],[24,16]]);
});
test("quality filter rejects small, blurred or low-confidence faces", () => {
  const box={width:100,height:100,score:.9,landmarks:ALIGN_POINTS};
  assert.equal(faceQualityReason({...box,width:20}),"人脸太小");
  assert.equal(faceQualityReason({...box,score:.4}),"低置信度");
  assert.equal(faceQualityReason(box,new Uint8ClampedArray(112*112*4)),"人脸模糊");
  const pixels=new Uint8ClampedArray(112*112*4);
  for(let i=0;i<112*112;i++){const value=(i+Math.floor(i/112))%2?255:0;pixels.set([value,value,value,255],i*4);}
  assert.equal(faceQualityReason(box,pixels),"");
});
test("profile landmarks pass quality checks despite nose offset and compressed eye spacing", () => {
  const pixels=new Uint8ClampedArray(112*112*4);
  for(let i=0;i<112*112;i++){const value=(i+Math.floor(i/112))%2?255:0;pixels.set([value,value,value,255],i*4);}
  for(const landmarks of [
    [[40,40],[45,40],[75,65],[43,88],[55,88]],
    [[40,40],[40.5,40],[60,65],[42,88],[54,88]],
  ]) {
    const box={width:100,height:100,score:.9,landmarks};
    assert.equal(faceQualityReason(box),"");
    assert.equal(faceQualityReason(box,pixels),"");
    assert.ok(similarityTransform(landmarks).every(Number.isFinite));
    assert.equal(faceQualityReason(box,new Uint8ClampedArray(pixels.length)),"人脸模糊");
  }
});
test("invalid or collapsed landmarks remain excluded without failing the whole photo", () => {
  for(const landmarks of [undefined,[[1,2]],Array(5).fill([1,1]),[...ALIGN_POINTS.slice(0,4),[NaN,1]]]) {
    assert.equal(faceQualityReason({width:100,height:100,score:.9,landmarks}),"关键点无效");
  }
});
test("profile reindex covers old missing diagnostics and pose rejections, then stops after update", () => {
  assert.equal(needsFaceDetailsUpdate(undefined),true);
  assert.equal(needsFaceDetailsUpdate({rejected:[{reason:"侧脸角度过大"},{reason:"人脸太小"}]}),true);
  assert.equal(needsFaceDetailsUpdate({rejected:[{reason:"人脸太小"}]}),false);
  assert.equal(needsFaceDetailsUpdate({rejected:[]}),false);
});

test("average grouping blocks chain merges through a single similar vector", () => {
  const vector=degrees=>[Math.cos(degrees*Math.PI/180),Math.sin(degrees*Math.PI/180)];
  const groups=[];
  for(const [i,angle] of[0,50,100].entries())groupDetectedFaces(groups,[{descriptor:vector(angle)}],String(i));
  assert.equal(groups.length,2);assert.ok(!groups.some(g=>g.photos.includes("0")&&g.photos.includes("2")));
});

test("grouping and reference lookup both default to the inclusive 0.30 threshold", () => {
  const photos=[{docid:"one",rev:"r"},{docid:"two",rev:"r"}];
  for(const similarity of[.15,.23,.29,.30,.31]){
    const faces=[{descriptor:[1,0]},{descriptor:[similarity,Math.sqrt(1-similarity**2)]}];
    const indices=new Map(photos.map((photo,i)=>[faceIndexKey(photo),[faces[i]]]));
    const groups=[];
    photos.forEach((photo,i)=>groupDetectedFaces(groups,[faces[i]],photo.docid));
    assert.equal(groups.length,similarity>=.30?1:2,`grouping at ${similarity}`);
    assert.deepEqual(referencePhotoIds([faces[0]],indices,photos),similarity>=.30?["one","two"]:["one"],`reference lookup at ${similarity}`);
  }
});
test("slider thresholds update grouping and reference matches using the same cached features", () => {
  const photos=[{docid:"one",rev:"r"},{docid:"two",rev:"r"}];
  const faces=[{descriptor:[1,0]},{descriptor:[.2,Math.sqrt(1-.2**2)]}];
  const indices=new Map(photos.map((photo,i)=>[faceIndexKey(photo),[faces[i]]]));
  for (const threshold of [.1,.15,.2,.23,.8,.15]) {
    const groups=[];
    photos.forEach((photo,i)=>groupDetectedFaces(groups,[faces[i]],photo.docid,threshold));
    assert.equal(groups.length,threshold<=.2?1:2);
    assert.deepEqual(referencePhotoIds([faces[0]],indices,photos,threshold),threshold<=.2?["one","two"]:["one"]);
  }
  // Even at the loosest setting two faces in a single photo remain separate.
  const groups=[];
  groupDetectedFaces(groups,[{descriptor:[1,0]},{descriptor:[1,0]}],"same-photo",.1);
  assert.equal(groups.length,2);
});
test("invalid saved or supplied slider values fall back to 0.30", () => {
  for(const value of[null,undefined,"",NaN,Infinity,"invalid",-.1,0,.09,.81,{},true]) assert.equal(normalizeMatchThreshold(value),.30);
  for(const value of[.1,.23,.8,"0.15"]) assert.equal(normalizeMatchThreshold(value),Number(value));
});
test("single matching retains the previous relaxed floor to limit chain merges", () => {
  const groups=[];
  const faces=[[1,0],[.5,Math.sqrt(.75)],[.09,Math.sqrt(1-.09**2)]];
  faces.forEach((descriptor,i)=>groupDetectedFaces(groups,[{descriptor}],String(i)));
  assert.equal(groups.length,2);assert.ok(!groups.some(g=>g.photos.includes("0")&&g.photos.includes("2")));
});

test("legacy indices are counted without downloading their incompatible vectors", async t => {
  const file={docid:"gns://root/"+"B".repeat(32),rev:"C".repeat(32),name:"photo.jpg"};let requests=0;
  t.mock.method(globalThis,"fetch",async url=>{
    requests++;assert.ok(url.includes("listdir"));
    return Response.json({files:[{name:`__run_faces_v2_${"B".repeat(32)}_${file.rev}_${"D".repeat(32)}.json`}],dirs:[]});
  });
  const data=await loadFaceIndices({link:"share",password:"test"},"gns://root",[file]);
  assert.equal(data.indices.size,0);assert.equal(data.legacyCount,1);assert.equal(requests,1);
});
test("deferred indexing uploads the original once and never starts inference", async t => {
  let transfers=0;
  t.mock.method(globalThis,"fetch",async url=>url.includes("osbeginupload")?Response.json({docid:"gns://root/photo",rev:"r",authrequest:["POST","https://driveoss.westlake.edu.cn/file"]}):Response.json({}));
  const result=await uploadPhotoWithIndex({link:"share",password:"test"},"gns://root","gns://root",new File(["photo"],"test.jpg"),"test.jpg",{
    buildIndex:false,transfer:async()=>{transfers++;},analyze:async()=>{assert.fail("inference must be skipped");},
  });
  assert.equal(transfers,1);assert.equal(result.deferred,true);assert.equal(result.indexed,false);assert.equal(result.stored.docid,"gns://root/photo");
});

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
  const faces = [{descriptor:[1,0],avatar:"a"},{descriptor:[1,.01],avatar:"b"}];
  const groups=[];
  groupDetectedFaces(groups,faces,"photo-one");
  assert.equal(groups.length,2);
  groupDetectedFaces(groups,[{descriptor:[1,0],avatar:"c"}],"photo-two");
  assert.equal(groups.length,2); assert.equal(groups[0].photos.length,2);
});
test("stop is honored before loading or decoding any original or models", async () => {
  const signal = AbortSignal.abort();
  for (const promise of [prepareFaceAnalysis({signal}),analyzePhoto({url:"invalid"},{signal}),detectOriginalFaces({}, {signal}),describeDetectedFaces({}, [], {signal})]) await assert.rejects(promise,{name:"AbortError"});
});
test("index validation binds cached vectors to the exact photo revision", () => {
  const file={docid:"gns://root/photo",rev:"one"};
  const face={descriptor:Array(128).fill(1/Math.sqrt(128)),box:[0,0,100,100],avatar:"data:image/jpeg;base64,AA=="};
  const record={version:3,engine:FACE_ENGINE,...file,faces:[face]};
  assert.equal(validateFaceIndex(record,file).length,1);
  assert.throws(()=>validateFaceIndex(record,{...file,rev:"two"}));
  assert.throws(()=>validateFaceIndex({...record,faces:[{...face,descriptor:[1,2]}]},file));
  assert.throws(()=>validateFaceIndex({...record,version:2},file));
  assert.throws(()=>validateFaceIndex({...record,engine:"another-model"},file));
  assert.throws(()=>validateFaceIndex({...record,faces:[{...face,descriptor:Array(128).fill(.1)}]},file));
});
test("reference matching uses saved synthetic vectors and returns all matching photo ids", () => {
  const photos=[{docid:"one",rev:"r"},{docid:"two",rev:"r"},{docid:"three",rev:"r"}];
  const indices=new Map([[faceIndexKey(photos[0]),[{descriptor:[0,1]},{descriptor:[1,0]}]],[faceIndexKey(photos[1]),[{descriptor:normalizeDescriptor([1,.1])}]],[faceIndexKey(photos[2]),[{descriptor:[0,1]}]]]);
  assert.deepEqual(referencePhotoIds([{descriptor:[1,0]}],indices,photos),["one","two"]);
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

test("new default migrates the old default once while preserving custom and subsequent choices", () => {
 assert.equal(restoreMatchThreshold(null,null),.30);
 assert.equal(restoreMatchThreshold(null,"0.23"),.30);
 assert.equal(restoreMatchThreshold(null,"0.15"),.15);
 assert.equal(restoreMatchThreshold(null,"0.8"),.8);
 assert.equal(restoreMatchThreshold("0.23","0.23"),.23);
 assert.equal(restoreMatchThreshold("0.4","0.23"),.4);
});
