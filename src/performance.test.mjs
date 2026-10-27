import test from "node:test";
import assert from "node:assert/strict";
import {analysisCacheKey,prepareCachedPhoto,finishCachedPhoto,prefetchOne} from "./analysis-cache.js";
import {recognizeBatch} from "./recognition-batch.js";
import {cacheSimilarities,clearSimilarityCache,cosineSimilarity} from "./sface-utils.js";
import {buildPeople} from "./people.js";

test("resume key isolates photo revisions, share scope and reviewed geometry",()=>{
  const p={docid:'photo',rev:'r'},a={box:[0,0,100,100]},b={box:[100,0,50,50]};
  const key=analysisCacheKey(p,'scope',[a,b]);
  assert.equal(key,analysisCacheKey(p,'scope',[b,a]));
  for(const other of [analysisCacheKey({...p,rev:'r2'},'scope',[a,b]),analysisCacheKey(p,'other',[a,b]),analysisCacheKey(p,'scope',[a])])assert.notEqual(key,other);
  assert.equal(analysisCacheKey({},'scope'),null);
});
test("cached results bypass original downloads and inference, including zero faces",async()=>{
  const cached={faces:[],diagnostics:{accepted:0,rejected:[],totalDetected:0}};
  const prepared=await prepareCachedPhoto({docid:'p',rev:'r'},{scope:'s',read:async()=>cached,loadBlob:()=>assert.fail('download')});
  assert.deepEqual(await finishCachedPhoto(prepared,{analyze:()=>assert.fail('inference')}),cached);
});
test("analysis is persisted before caller uploads, so failed upload can resume",async()=>{
  let saved,alive;const photo={docid:'p',rev:'r'};
  const prepared=await prepareCachedPhoto(photo,{scope:'s',read:async()=>null,loadBlob:async()=>new Blob(['image'])});
  const result=await finishCachedPhoto(prepared,{analyze:async({url},options)=>{alive=url;assert.equal(await(await fetch(url)).text(),'image');options.onDiagnostics({accepted:0,rejected:[],totalDetected:0});return [];},write:async(key,p,faces,diagnostics)=>{saved={faces,diagnostics};assert.equal(key,prepared.key);assert.equal(p,photo);}});
  assert.deepEqual(saved,result);await assert.rejects(fetch(alive));
  const retry=await prepareCachedPhoto(photo,{scope:'s',read:async()=>saved,loadBlob:()=>assert.fail('retry download')});
  assert.deepEqual(await finishCachedPhoto(retry),result);
});
test("prefetch overlaps processing with exactly one future download and observes errors",async()=>{
  const started=[];const stream=prefetchOne([0,1,2],async i=>{started.push(i);if(i===1)throw Error('download failed');return i;});
  assert.equal((await stream.next()).value.value,0);assert.deepEqual(started,[0,1]);
  assert.match((await stream.next()).value.error.message,/download failed/);assert.deepEqual(started,[0,1,2]);
  assert.equal((await stream.next()).value.value,2);assert.equal((await stream.next()).done,true);
});
test("aborting stops prefetch and prevents storing partial inference",async()=>{
  const abort=new AbortController();abort.abort();let calls=0;
  const stream=prefetchOne([1,2],async()=>{calls++;},abort.signal);
  await assert.rejects(stream.next(),{name:'AbortError'});assert.equal(calls,0);
  await assert.rejects(finishCachedPhoto({blob:new Blob(['x'])},{signal:abort.signal,write:()=>assert.fail('partial write')}),{name:'AbortError'});
});
test("Float64 memoization preserves exact scores and grouping across thresholds",()=>{
  const faces=Array.from({length:12},(_,i)=>{const angle=i*.15;return {key:String(i),photoId:String(i),box:[0,0,100,100],yawProxy:i%3===0?1.2:0,sharpness:100,detectorScore:.95,descriptor:[Math.cos(angle),Math.sin(angle),...Array(510).fill(0)]};});
  const thresholds=[.3,.48,.65,.8],expected=thresholds.map(t=>buildPeople(faces,t));
  const stats=cacheSimilarities(faces.map(f=>f.descriptor));
  try{
    thresholds.forEach((t,i)=>assert.deepEqual(buildPeople(faces,t),expected[i]));assert.ok(stats.hits>stats.misses);
    const before=stats.misses;thresholds.forEach(t=>buildPeople(faces,t));assert.equal(stats.misses,before);
    const replacement=[0,1,...Array(510).fill(0)];assert.equal(cosineSimilarity(faces[0].descriptor,replacement),0);
  }finally{clearSimilarityCache();}
});
function fakeRuntime(failBatch=false){
  const calls=[],disposed=[];
  class Tensor{constructor(type,data,dims){this.data=data;this.dims=dims;}dispose(){disposed.push('input');}}
  const session={inputNames:['x'],outputNames:['y'],inputMetadata:[{shape:['N',3,112,112]}],run:async({x})=>{
    calls.push(x.dims[0]);if(failBatch&&x.dims[0]>1)throw Error('unsupported');
    const data=new Float32Array(x.dims[0]*512);
    for(let i=0;i<x.dims[0];i++){data[i*512]=1;data[i*512+1]=x.data[i*3*112*112];}
    return {y:{data,dispose(){disposed.push('output');}}};
  }};return {session,ort:{Tensor},calls,disposed};
}
test("batched inference preserves order, normalizes each face and handles remainder",async()=>{
  const pixels=Array.from({length:5},(_,i)=>new Float32Array(3*112*112).fill(i)),a=fakeRuntime(),b=fakeRuntime();
  const expected=await recognizeBatch(a.session,a.ort,pixels,{batchSize:1});
  assert.deepEqual(await recognizeBatch(b.session,b.ort,pixels),expected);assert.deepEqual(b.calls,[4,1]);assert.equal(b.disposed.length,4);
});
test("unsupported batches fall back once without dropping faces or repeating successful ones",async()=>{
  const a=fakeRuntime(true),pixels=Array.from({length:5},()=>new Float32Array(3*112*112));
  assert.equal((await recognizeBatch(a.session,a.ort,pixels)).length,5);assert.deepEqual(a.calls,[4,1,1,1,1,1]);
  await recognizeBatch(a.session,a.ort,pixels.slice(0,2));assert.deepEqual(a.calls.slice(-2),[1,1]);
});
