// Local-only benchmark: no shared index uploads. See GITHUB_PAGES.md.
import {createPhotoPool} from '/src/photo-pool.js';
import {buildPeople,faceKey} from '/src/people.js';
import {runConcurrentPhotos} from '/src/concurrent-photos.js';
const status=document.querySelector('#status'),button=document.querySelector('#run');
const results=[];let baseline,baselineGroups,baselineHashes;
new MutationObserver(()=>localStorage.setItem("cpu-parallel-results-v1",status.textContent)).observe(status,{childList:true,characterData:true,subtree:true});
button.onclick=async()=>{button.disabled=true;try{
 const photos=await(await fetch('/tmp/face-experiment/parallel-fixture.json')).json();
 const albums=await(await fetch('/tmp/face-experiment/parallel-groups.json')).json(),dataset=await(await fetch('/tmp/face-experiment/dataset.json')).json();
 const membership=outputs=>albums.map(album=>{
  const photoIds=new Set(album.faces.map(f=>f.photoId)),selected=photos.filter(p=>photoIds.has(p.docid)),ids=new Set(selected.map(p=>p.docid));
  const faces=[...album.faces.filter(f=>!ids.has(f.photoId)),...photos.flatMap((p,i)=>ids.has(p.docid)?outputs[i].faces.map(f=>({...f,key:faceKey(p,f),photoId:p.docid,photoName:p.name})):[])];
  return [.3,.48,.65,.8].map(t=>{const m=buildPeople(faces,t,dataset.albums.find(a=>a.id===album.id).review);return {groups:m.groups.map(g=>[g.id,g.faces.map(f=>f.key).sort()]),pending:m.pending.map(f=>f.key),ignored:m.ignored.map(f=>f.key),unrecognized:m.unrecognized.map(f=>f.key),conflicts:m.conflicts.map(f=>f.key)};});
 });
 const {analyzePhoto}=await import('/src/faces.js');
 status.textContent='检查主线程与独立线程的一致性';
 let mainDiagnostics;const main=await analyzePhoto(photos[0],{onDiagnostics:d=>mainDiagnostics=d});
 const checkPool=createPhotoPool();try{const workerFaces=await checkPool.analyze(0,photos[0]);if(JSON.stringify(main)!==JSON.stringify(workerFaces))throw Error('Main/worker face records differ');}finally{checkPool.close();}
 for(const concurrency of (new URLSearchParams(location.search).get("counts")||"1,2,4,6,8").split(",").map(Number).filter(n=>[1,2,4,6,8,12,16].includes(n))){
  const pool=createPhotoPool(),start=performance.now();let done=0;const output=[],hashes={},current={};
  try{
   status.textContent=JSON.stringify({results,stage:'prepare',concurrency});
   await runConcurrentPhotos(Array.from({length:concurrency},(_,i)=>i),2,async i=>{const proxies=await pool.prepare(i),run=proxies.recognize.run;proxies.recognize.run=async feeds=>{const input=Object.values(feeds)[0],values=new Uint32Array(input.data.buffer,input.data.byteOffset,input.data.length);let h=2166136261;for(const v of values)h=Math.imul(h^v,16777619);(hashes[current[i]]||=[]).push(h);return run(feeds);};});
   const prepared=performance.now(),processing=performance.now();
   await runConcurrentPhotos(photos,concurrency,async(photo,i,lane)=>{
    current[lane]=photo.url;let diagnostics;const faces=await pool.analyze(lane,photo,{onDiagnostics:d=>diagnostics=d});output[i]={faces,diagnostics};done++;
    status.textContent=JSON.stringify({results,stage:'compute',concurrency,done,total:photos.length,elapsedMs:performance.now()-processing});
   });
   const end=performance.now();
   const compare=(a,b)=>{let delta=0;if(a.faces.length!==b.faces.length||JSON.stringify(a.diagnostics.rejected.map(f=>[f.box,f.reason]))!==JSON.stringify(b.diagnostics.rejected.map(f=>[f.box,f.reason])))throw Error('Detection difference');for(let i=0;i<a.faces.length;i++){if(JSON.stringify(a.faces[i].box)!==JSON.stringify(b.faces[i].box))throw Error('Box difference '+JSON.stringify([a.faces[i].box,b.faces[i].box,a.faces[i].descriptor.slice(0,4),b.faces[i].descriptor.slice(0,4)]));for(let j=0;j<512;j++)delta=Math.max(delta,Math.abs(a.faces[i].descriptor[j]-b.faces[i].descriptor[j]));}return delta;};
   let delta=compare({faces:main,diagnostics:mainDiagnostics},output[0]);
   if(baseline)output.forEach((o,i)=>delta=Math.max(delta,compare(baseline[i],o)));else baseline=output;
   const groups=membership(output);let sameGroups=true,sameInputs=true;
   if(baselineGroups){sameGroups=JSON.stringify(groups)===JSON.stringify(baselineGroups);sameInputs=photos.every(p=>JSON.stringify(hashes[p.url])===JSON.stringify(baselineHashes[p.url]));}else{baselineGroups=groups;baselineHashes=hashes;}

   results.push({concurrency,photos:photos.length,faces:output.reduce((n,o)=>n+o.faces.length,0),prepareMs:prepared-start,computeMs:end-processing,totalMs:end-start,maxDelta:delta,sameGroups,sameInputs});
   if(!sameGroups)throw Error("Classification changed");
   status.textContent=JSON.stringify({results,stage:'finished-phase'});
  }finally{pool.close();}
 }
 status.textContent=JSON.stringify({pass:true,results},null,2);
}catch(e){status.textContent=JSON.stringify({results,error:e.stack},null,2);}finally{button.disabled=false;}};

button.disabled=false;
