import { faceTiles, deduplicateFaces, boundedFaceCrop } from "./face-utils.js";
import { loadAnalysisImage } from "./image-input.js";
import { decodeYuNet, planarPixels, similarityTransform, normalizeDescriptor, faceQualityReason } from "./sface-utils.js";
let runtimePromise, detectorPromise, recognitionPromise;
const yieldUI = () => new Promise(resolve => setTimeout(resolve,0));
function checkAbort(signal) { if (signal?.aborted) throw new DOMException("分析已停止","AbortError"); }
function assetUrl(path) { return new URL(import.meta.env.BASE_URL + path, document.baseURI).href; }
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
async function loadSession(kind,{signal,onProgress=()=>{}}={}) {
  checkAbort(signal); const existing=kind === "detect" ? detectorPromise : recognitionPromise;
  if(existing) { const session=await existing; checkAbort(signal); return session; }
  const pending=(async()=>{
    const ort=await runtime();checkAbort(signal);
    const name=kind === "detect" ? "face_detection_yunet_2026may.onnx" : "face_recognition_sface_2021dec.onnx";
    const bytes=await modelBytes(name,signal,onProgress);checkAbort(signal);
    onProgress(kind === "detect" ? "准备 YuNet 人脸检测…" : "准备 SFace 人脸特征…");
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
export async function detectOriginalFaces(image,{signal,onProgress=()=>{}}={}) {
  checkAbort(signal);const session=await loadSession("detect",{signal,onProgress}),ort=await runtime();
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  const tiles=faceTiles(width,height,1200),regions=tiles.length===1?tiles:[{x:0,y:0,width,height},...tiles];
  const canvas=canvasOf(640),ctx=canvas.getContext("2d",{willReadFrequently:true}),boxes=[];
  try {
    for(let i=0;i<regions.length;i++) {
      checkAbort(signal);onProgress(`原图检测 ${i+1}/${regions.length}`);await yieldUI();checkAbort(signal);
      const region=regions[i],scale=Math.min(1,640/Math.max(region.width,region.height));
      const drawnW=Math.max(1,Math.round(region.width*scale)),drawnH=Math.max(1,Math.round(region.height*scale));
      ctx.fillStyle="#000";ctx.fillRect(0,0,640,640);ctx.drawImage(image,region.x,region.y,region.width,region.height,0,0,drawnW,drawnH);
      // OpenCV: YuNet raw BGR 0..255; SFace raw RGB 0..255.
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
    return deduplicateFaces(boxes).slice(0,200);
  }finally{canvas.width=0;canvas.height=0;}
}
export async function analyzePhoto(photo,options={}) {
  checkAbort(options.signal);const image=await loadAnalysisImage(photo.url,options.signal);
  try {const boxes=await detectOriginalFaces(image,options);return await describeDetectedFaces(image,boxes,options);}
  finally{image.src="";}
}
export async function describeDetectedFaces(image,boxes,{signal,onProgress=()=>{}}={}) {
  checkAbort(signal);const faces=[];if(!boxes.length)return faces;
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height,ort=await runtime();let session,skipped=0;
  for(let i=0;i<boxes.length;i++) {
    onProgress(`处理人脸 ${i+1}/${boxes.length}`);await yieldUI();checkAbort(signal);
    const box=boxes[i];if(faceQualityReason(box)){skipped++;continue;}
    const crop=canvasOf(112),ctx=crop.getContext("2d",{willReadFrequently:true});let input,outputs,avatar;
    try {
      ctx.setTransform(...similarityTransform(box.landmarks));ctx.drawImage(image,0,0);ctx.resetTransform();
      const pixels=ctx.getImageData(0,0,112,112).data;if(faceQualityReason(box,pixels)){skipped++;continue;}
      session ||= await loadSession("recognize",{signal,onProgress});checkAbort(signal);
      input=new ort.Tensor("float32",planarPixels(pixels,112,112,"RGB"),[1,3,112,112]);
      outputs=await session.run({[session.inputNames[0]]:input});checkAbort(signal);
      const descriptor=normalizeDescriptor(outputs[session.outputNames[0]].data);if(descriptor.length!==128)throw new Error("SFace 特征维度不兼容");
      const bounded=boundedFaceCrop(box,width,height);avatar=canvasOf(120);
      avatar.getContext("2d").drawImage(image,bounded.x,bounded.y,bounded.width,bounded.height,0,0,120,120);
      faces.push({descriptor,box:[box.x,box.y,box.width,box.height],avatar:avatar.toDataURL("image/jpeg",.75)});
    }finally{input?.dispose?.();releaseOutputs(outputs);crop.width=0;crop.height=0;if(avatar){avatar.width=0;avatar.height=0;}}
  }
  onProgress(`已提取 ${faces.length} 张清晰人脸${skipped?`，跳过 ${skipped} 张模糊、小脸或大角度侧脸`:""}`);return faces;
}
