import { recognizeBatch } from "./recognition-batch.js";
import { faceTiles, deduplicateFaces, boundedFaceCrop } from "./face-utils.js";
import { loadAnalysisImage } from "./image-input.js";
import { decodeYuNet, planarPixels, similarityTransform, faceQualityReason, blurVariance } from "./sface-utils.js";
import { FUSION_ENGINE, ARCFACE_SHA256, ARCFACE_BYTES, ARCFACE_CHUNK_BYTES, arcfacePixels, yawProxy, preserveFaceBoxes } from "./fusion-utils.js";
let runtimePromise, detectorPromise, recognitionPromise, configuredBase;
export function configureFaceAssets(base) { configuredBase = base; }
const yieldUI = () => new Promise(resolve => setTimeout(resolve,0));
function checkAbort(signal) { if (signal?.aborted) throw new DOMException("分析已停止","AbortError"); }
function assetUrl(path) { return new URL(path, configuredBase || new URL(import.meta.env.BASE_URL, document.baseURI)).href; }
async function runtime() {
  if (!runtimePromise) runtimePromise = import("onnxruntime-web/wasm").then(ort => {
    // One thread works on Pages without COOP/COEP, including mobile Safari.
    // The Emscripten factory is embedded in our entry bundle.
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { wasm: assetUrl("runtime/ort-1.24.3/ort-wasm-simd-threaded.wasm") };
    return ort;
  }).catch(e => { runtimePromise = null; throw e; });
  return runtimePromise;
}
async function modelBytes(name, signal, onProgress) {
  const url = assetUrl("models/sface-v1/" + name); let cache;
  try { cache = await caches.open("running-sface-models-v1"); const cached = await cache.match(url); if (cached) return new Uint8Array(await cached.arrayBuffer()); } catch {}
  checkAbort(signal); onProgress("首次下载识别模型，请保持网页打开…");
  const response = await fetch(url,{signal,credentials:"omit"});
  if (!response.ok) throw new Error(`模型下载失败（${response.status}），请检查网络后重试`);
  const copy = response.clone(), bytes = new Uint8Array(await response.arrayBuffer()); checkAbort(signal);
  if (bytes.length < 100000) throw new Error("模型文件不完整，请刷新页面后重试");
  try { await cache?.put(url,copy); } catch {}
  return bytes;
}
async function arcfaceBytes(signal,onProgress) {
  const bytes=new Uint8Array(ARCFACE_BYTES);let cache;
  try {cache=await caches.open("running-arcface-r50-v1");} catch {}
  for(let i=0;i<4;i++){
    checkAbort(signal);onProgress(`首次准备融合模型 ${i+1}/4（共约 174 MB，可缓存复用）…`);
    const url=assetUrl(`models/arcface-v1/w600k_r50.part${i}.bin`);
    let response;try{response=await cache?.match(url);}catch{}
    if(!response){response=await fetch(url,{signal,credentials:"omit"});if(!response.ok)throw new Error(`融合模型下载失败（${response.status}），请检查网络或稍后用电脑重试`);try{await cache?.put(url,response.clone());}catch{}}
    const part=new Uint8Array(await response.arrayBuffer());checkAbort(signal);
    if(part.length!==Math.min(ARCFACE_CHUNK_BYTES,ARCFACE_BYTES-i*ARCFACE_CHUNK_BYTES)){try{await cache?.delete(url);}catch{}throw new Error("融合模型分片不完整，请重试");}
    bytes.set(part,i*ARCFACE_CHUNK_BYTES);
  }
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  if(hash!==ARCFACE_SHA256){try{await caches.delete("running-arcface-r50-v1");}catch{}throw new Error("融合模型校验失败，请重新下载");}
  checkAbort(signal);return bytes;
}
async function loadSession(kind,{signal,onProgress=()=>{}}={}) {
  checkAbort(signal); const existing=kind === "detect" ? detectorPromise : recognitionPromise;
  if(existing) { const session=await existing; checkAbort(signal); return session; }
  const pending=(async()=>{
    const ort=await runtime();checkAbort(signal);
    const bytes=kind==="detect"?await modelBytes("face_detection_yunet_2026may.onnx",signal,onProgress):await arcfaceBytes(signal,onProgress);checkAbort(signal);
    onProgress(kind === "detect" ? "准备 YuNet 人脸检测…" : "准备 ArcFace 多角度人脸特征…");
    return ort.InferenceSession.create(bytes,{executionProviders:["wasm"],graphOptimizationLevel:"all"});
  })().catch(e=>{if(kind === "detect")detectorPromise=null;else recognitionPromise=null;throw e;});
  if(kind === "detect")detectorPromise=pending;else recognitionPromise=pending;
  const session=await pending;checkAbort(signal);return session;
}
export async function prepareFaceAnalysis(options={}) {
  checkAbort(options.signal);await loadSession("detect",options);await loadSession("recognize",options);
}
function canvasOf(size) { const c=document.createElement("canvas");c.width=size;c.height=size;return c; }
function releaseOutputs(outputs) { for(const tensor of Object.values(outputs||{}))tensor.dispose?.(); }
// Detection can be tested without extracting or comparing identity features.
export async function detectOriginalFaces(image,{signal,onProgress=()=>{},sessions}={}) {
  checkAbort(signal);const session=sessions?.detect || await loadSession("detect",{signal,onProgress}),ort=await runtime();
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  const tiles=faceTiles(width,height,1200),regions=tiles.length===1?tiles:[{x:0,y:0,width,height},...tiles];
  const canvas=canvasOf(640),ctx=canvas.getContext("2d",{willReadFrequently:true}),boxes=[];
  try {
    for(let i=0;i<regions.length;i++) {
      checkAbort(signal);onProgress(`原图检测 ${i+1}/${regions.length}`);if(!sessions)await yieldUI();checkAbort(signal);
      const region=regions[i],scale=Math.min(1,640/Math.max(region.width,region.height));
      const drawnW=Math.max(1,Math.round(region.width*scale)),drawnH=Math.max(1,Math.round(region.height*scale));
      ctx.fillStyle="#000";ctx.fillRect(0,0,640,640);ctx.drawImage(image,region.x,region.y,region.width,region.height,0,0,drawnW,drawnH);
      // YuNet expects raw BGR values; ArcFace normalization is separate.
      const input=new ort.Tensor("float32",planarPixels(ctx.getImageData(0,0,640,640).data,640,640,"BGR"),[1,3,640,640]);let outputs;
      try {
        outputs=await session.run({[session.inputNames[0]]:input});checkAbort(signal);
        for(const b of deduplicateFaces(decodeYuNet(outputs))) {
          if(b.x+b.width/2>drawnW||b.y+b.height/2>drawnH)continue;
          const sx=region.width/drawnW,sy=region.height/drawnH;
          boxes.push({...b,x:b.x*sx+region.x,y:b.y*sy+region.y,width:b.width*sx,height:b.height*sy,
            landmarks:b.landmarks.map(([x,y])=>[x*sx+region.x,y*sy+region.y])});
        }
      }finally{input.dispose?.();releaseOutputs(outputs);}
    }
    const all = deduplicateFaces(boxes), result = all.slice(0,200);
    result.totalDetected = all.length;
    return result;
  }finally{canvas.width=0;canvas.height=0;}
}
export async function analyzePhoto(photo,options={}) {
  checkAbort(options.signal);const image=await loadAnalysisImage(photo.url,options.signal);
  try {return await analyzeImage(image,options);}
  finally{image.src="";}
}
export async function analyzeImage(image,options={}) {
  const detected=await detectOriginalFaces(image,options),boxes=preserveFaceBoxes(options.previousFaces,detected);
  return describeDetectedFaces(image,boxes,options);
}
export async function describeDetectedFaces(image,boxes,{signal,onProgress=()=>{},onDiagnostics=()=>{},batchSize=4,sessions}={}) {
  checkAbort(signal);const faces=[],rejected=[];
  const report=()=>onDiagnostics({version:1,engine:FUSION_ENGINE,totalDetected:boxes.totalDetected||boxes.length,accepted:faces.length,rejected});
  if(!boxes.length){report();return faces;}
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height,ort=await runtime();let session,skipped=0;
  const pending=[];
  const flush=async()=>{
    if(!pending.length)return;
    session ||= sessions?.recognize || await loadSession("recognize",{signal,onProgress});
    const descriptors=await recognizeBatch(session,ort,pending.map(p=>p.pixels),{signal,batchSize});
    pending.forEach((p,i)=>faces.push({...p.face,descriptor:descriptors[i]}));pending.length=0;
  };
  for(let i=0;i<boxes.length;i++) {
    onProgress(`处理人脸 ${i+1}/${boxes.length}`);if(!sessions)await yieldUI();checkAbort(signal);
    const box=boxes[i];
    const bounded=boundedFaceCrop(box,width,height),preview=canvasOf(80);
    preview.getContext("2d").drawImage(image,bounded.x,bounded.y,bounded.width,bounded.height,0,0,80,80);
    const previewUrl=preview.toDataURL("image/jpeg",.65);preview.width=0;preview.height=0;
    const reject=reason=>{skipped++;rejected.push({box:[box.x,box.y,box.width,box.height],avatar:previewUrl,reason});};
    const reason=box.migrationReason||faceQualityReason(box);if(reason){reject(reason);continue;}
    const crop=canvasOf(112),ctx=crop.getContext("2d",{willReadFrequently:true});let avatar;
    try {
      ctx.setTransform(...similarityTransform(box.landmarks));ctx.drawImage(image,0,0);ctx.resetTransform();
      const pixels=ctx.getImageData(0,0,112,112).data,reason=faceQualityReason(box,pixels);if(reason){reject(reason);continue;}
      avatar=canvasOf(120);
      avatar.getContext("2d").drawImage(image,bounded.x,bounded.y,bounded.width,bounded.height,0,0,120,120);
      pending.push({pixels:arcfacePixels(pixels),face:{box:[box.x,box.y,box.width,box.height],avatar:avatar.toDataURL("image/jpeg",.75),engine:FUSION_ENGINE,landmarks:box.landmarks,yawProxy:yawProxy(box.landmarks),detectorScore:box.score,sharpness:blurVariance(pixels,112,112)}});
      if(pending.length>=Math.max(1,Math.min(4,batchSize)))await flush();
    }finally{crop.width=0;crop.height=0;if(avatar){avatar.width=0;avatar.height=0;}}
  }
  await flush();checkAbort(signal);report();onProgress(`已提取 ${faces.length} 张清晰人脸${skipped?`，保留 ${skipped} 张未参与识别的人脸及原因`:""}`);return faces;
}

// Worker transport uses the same pixel tensors produced by the established
// HTML image/canvas path. Moving image scaling to OffscreenCanvas changes pixels.
export async function faceSessionInfo(options={}) {
  const info={};for(const kind of ["detect","recognize"]){const s=await loadSession(kind,options);info[kind]={inputNames:s.inputNames,outputNames:s.outputNames,inputMetadata:s.inputMetadata};}return info;
}
export async function runFaceTensor(kind,data,dims) {
  const session=await loadSession(kind),ort=await runtime(),input=new ort.Tensor("float32",data,dims);let outputs;
  try{outputs=await session.run({[session.inputNames[0]]:input});return Object.fromEntries(Object.entries(outputs).map(([name,t])=>[name,{data:t.data.slice(),dims:t.dims}]));}
  finally{input.dispose?.();releaseOutputs(outputs);}
}
