import test from "node:test";
import assert from "node:assert/strict";
import { buildPeople, faceKey } from "./people.js";
import { FUSION_ENGINE, arcfacePixels, yawProxy, preserveFaceBoxes, preserveReviewPositions, fusionThreshold } from "./fusion-utils.js";
import { validateFaceIndex, saveFaceIndex, loadFaceIndices, needsFusionUpgrade, referencePhotoIds } from "./face-cache.js";
import { ALIGN_POINTS, FACE_ENGINE } from "./sface-utils.js";
const avatar="data:image/jpeg;base64,AA==",root="gns://"+"A".repeat(32),person="a".repeat(32);
function face(id,angle=0,extra={}) {const v=angle*Math.PI/180;return {key:id,photoId:id,photoName:id,descriptor:[Math.cos(v),Math.sin(v),...Array(510).fill(0)],box:[0,0,100,100],avatar,landmarks:ALIGN_POINTS,yawProxy:0,sharpness:100,detectorScore:.95,engine:FUSION_ENGINE,...extra};}
test("ArcFace input is normalized RGB and pose is a projection independent of rotation",()=>{
  assert.deepEqual(Array.from(arcfacePixels(new Uint8Array([0,127,255,255]),1,1)),[-1,Math.fround(-.5/127.5),1]);
  assert.equal(yawProxy([[0,0],[10,0],[15,6],[0,10],[10,10]]),1);
  assert.equal(yawProxy([[0,0],[0,10],[-6,15],[-10,0],[-10,10]]),1);
  assert.equal(yawProxy(Array(5).fill([0,0])),null);
  assert.equal(fusionThreshold(null),.48);assert.equal(fusionThreshold(.1),.48);
});
test("fusion adds a profile to frozen frontal seeds but never uses added faces as anchors",()=>{
  const input=[face('a'),face('b',5),face('side',50,{yawProxy:1.2}),face('chain',90,{yawProxy:1.4})];
  const result=buildPeople(input,.48),g=result.groups[0];
  assert.ok(g.faces.some(f=>f.key==='side'&&f.suggested));assert.ok(!g.faces.some(f=>f.key==='chain'));
  assert.equal(g.suggestedCount,1);assert.ok(result.pending.some(f=>f.key==='chain'));
  assert.deepEqual(buildPeople([...input].reverse(),.48),result);
});
test("profile-only groups remain pending and manual labels still override pose/quality",()=>{
  const input=[face('a',0,{yawProxy:1}),face('b',1,{yawProxy:1.1})];
  assert.equal(buildPeople(input,.48).groups.length,0);
  const result=buildPeople(input,.48,{assignments:{a:person,b:person},names:{[person]:'确认'}});
  assert.equal(result.groups[0].confirmedCount,2);assert.equal(result.groups[0].name,'确认');
});
test("fusion blocks same-photo collisions, ambiguous people and simultaneous claims",()=>{
  const a=face('a'),b=face('b',90),query=face('q',45,{yawProxy:1});
  const ambiguous=buildPeople([a,b,query],.48,{assignments:{a:person,b:'other'},names:{}});
  assert.match(ambiguous.pending[0].reason,/多个人物/);
  const first=face('one',10,{photoId:'shared',yawProxy:1}),second=face('two',11,{photoId:'shared',yawProxy:1});
  const result=buildPeople([a,first,second],.48,{assignments:{a:person},names:{}});
  assert.equal(result.groups[0].faces.length,1);assert.equal(result.pending.length,2);
  const same=buildPeople([a,{...first,photoId:'a'}],.48,{assignments:{a:person},names:{}});
  assert.match(same.pending[0].reason,/同一张照片/);
});
test("old/new vectors never mix and ignored faces never become fusion seeds",()=>{
  const old={...face('old'),descriptor:[1,...Array(127).fill(0)]},a=face('a'),b=face('b',1);
  const result=buildPeople([old,a,b],.48,{assignments:{b:'ignore'},names:{}});
  assert.equal(result.groups.length,0);assert.equal(result.ignored.length,1);
  assert.match(result.pending.find(f=>f.key==='old').reason,/旧版/);
  assert.deepEqual(referencePhotoIds([a],new Map([['old|r',[old]]]),[{docid:'old',rev:'r'}],.48),[]);
});
test("migration retains old keys including missing detections and appends only distinct new boxes",()=>{
  const previous=[face('a'),face('b',0,{box:[150,0,80,80]})];
  const detected=[{x:2,y:1,width:100,height:100,landmarks:ALIGN_POINTS,score:.9},{x:300,y:0,width:80,height:80,landmarks:ALIGN_POINTS,score:.9}];
  const upgraded=preserveFaceBoxes(previous,detected),photo={docid:'photo',rev:'rev'};
  for(let i=0;i<2;i++)assert.equal(faceKey(photo,previous[i]),faceKey(photo,{box:[upgraded[i].x,upgraded[i].y,upgraded[i].width,upgraded[i].height]}));
  assert.equal(upgraded[1].migrationReason,'未恢复关键点');assert.equal(upgraded.length,3);
});
test("v4 validation rejects mismatched models, incomplete metadata and wrong dimensions",()=>{
  const file={docid:root+'/photo',rev:'r'},record={version:4,engine:FUSION_ENGINE,...file,faces:[face('a')]};
  assert.equal(validateFaceIndex(record,file).length,1);
  for(const changes of [{descriptor:Array(128).fill(1/Math.sqrt(128))},{sharpness:NaN},{yawProxy:Infinity},{landmarks:[]},{box:[0,0,-1,10]}])assert.throws(()=>validateFaceIndex({...record,faces:[{...face('a'),...changes}]},file));
  assert.throws(()=>validateFaceIndex({...record,engine:FACE_ENGINE},file));
  assert.equal(needsFusionUpgrade([],undefined),true);
  assert.equal(needsFusionUpgrade([],{engine:FUSION_ENGINE}),false);
});
test("only manual review positions are needed to migrate; old feature indices are never downloaded",async t=>{
  const photo={docid:root+'/'+"B".repeat(32),rev:"C".repeat(32)};
  const key=faceKey(photo,face('a'));
  assert.deepEqual(preserveReviewPositions(photo,{[key]:person}),[{box:[0,0,100,100]}]);
  let requests=0;t.mock.method(globalThis,'fetch',async url=>{requests++;assert.ok(url.includes('listdir'));return Response.json({files:[{name:`__run_faces_v3_${'B'.repeat(32)}_${photo.rev}_${'D'.repeat(32)}.json`,docid:root+'/old'}],dirs:[]});});
  const result=await loadFaceIndices({link:'test'},root,[photo]);
  assert.equal(result.indices.size,0);assert.equal(result.legacyCount,1);assert.equal(requests,1);
  assert.throws(()=>validateFaceIndex({version:3,engine:FACE_ENGINE,...photo,faces:[]},photo));
});
test("v4 save/load prefers fusion over a newer v3 record and resumes empty upgraded photos",async t=>{
  const file={docid:root+'/'+"B".repeat(32),rev:"C".repeat(32),name:'photo.jpg'},session={link:'test'};let saved,filename;
  const oldName=`__run_faces_v3_${'B'.repeat(32)}_${file.rev}_${'D'.repeat(32)}.json`;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.startsWith('https://driveoss'))return Response.json(saved);
    const body=JSON.parse(options.body);
    if(url.includes('osbeginupload')){filename=body.name;return Response.json({docid:root+'/index',rev:'r',authrequest:['POST','https://driveoss.westlake.edu.cn/index']});}
    if(url.includes('listdir'))return Response.json({files:[{name:filename,docid:root+'/v4',create_time:1,size:200},{name:oldName,docid:root+'/v3',create_time:999,size:200}],dirs:[]});
    if(url.includes('osdownload')){assert.equal(body.docid,root+'/v4');return Response.json({authrequest:['GET','https://driveoss.westlake.edu.cn/index']});}
    return Response.json({});
  });
  await saveFaceIndex(session,root,file,[],{diagnostics:{version:1,engine:FUSION_ENGINE,totalDetected:0,accepted:0,rejected:[]},transfer:async transport=>{saved=JSON.parse(await transport.body.get('file').text());}});
  assert.equal(saved.version,4);const data=await loadFaceIndices(session,root,[file]);
  assert.equal(needsFusionUpgrade(data.indices.get(`${file.docid}|${file.rev}`)),false);
});
