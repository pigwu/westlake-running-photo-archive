import { FUSION_ENGINE } from "./fusion-utils.js";
import { validateFaceIndex, validateDiagnostics } from "./face-cache.js";

const DB = "running-fusion-analysis-v1", LIMIT = 128 * 1024 * 1024;
let database;
function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return database ||= new Promise(resolve => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const records = request.result.createObjectStore("results", { keyPath: "key" });
      records.createIndex("savedAt", "savedAt");
      request.result.createObjectStore("sizes", { keyPath: "key" });
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
    request.onerror = request.onblocked = () => { database = null; resolve(null); };
  });
}
export function analysisCacheKey(photo, scope, previousFaces = []) {
  if (!scope || !photo.docid || !photo.rev) return null;
  const boxes = previousFaces.map(f => f.box).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify([FUSION_ENGINE, scope, photo.docid, photo.rev, boxes]);
}
export async function readAnalysis(key, photo) {
  if (!key) return null;
  try {
    const db = await openDatabase(); if (!db) return null;
    const entry = await new Promise(resolve => {
      const request = db.transaction("results").objectStore("results").get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null);
    });
    if (!entry) return null;
    const faces = validateFaceIndex(entry.record, photo), diagnostics = validateDiagnostics(entry.record.diagnostics, faces.length);
    if (!diagnostics) return null;
    return { faces, diagnostics };
  } catch { return null; } // Private mode / quota / corrupt entries must not block recognition.
}
export async function writeAnalysis(key, photo, faces, diagnostics) {
  if (!key || !diagnostics) return;
  try {
    const record = {version:4,engine:FUSION_ENGINE,docid:photo.docid,rev:photo.rev,faces,diagnostics};
    validateFaceIndex(record,photo); validateDiagnostics(diagnostics,faces.length);
    const bytes = new Blob([JSON.stringify(record)]).size; if (bytes > 8*1024*1024) return;
    const db = await openDatabase(); if (!db) return;
    await new Promise(resolve => {
      const tx = db.transaction(["results","sizes"],"readwrite"), results=tx.objectStore("results"), sizes=tx.objectStore("sizes");
      const savedAt=Date.now(); results.put({key,record,savedAt}); sizes.put({key,bytes,savedAt});
      const request=sizes.getAll();
      request.onsuccess=()=>{
        const entries=request.result.sort((a,b)=>a.savedAt-b.savedAt); let total=entries.reduce((n,e)=>n+e.bytes,0), count=entries.length;
        for(const entry of entries){if(total<=LIMIT&&count<=600)break;results.delete(entry.key);sizes.delete(entry.key);total-=entry.bytes;count--;}
      };
      tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();
    });
  } catch { /* Local persistence is optional; still save the shared index. */ }
}
export async function prepareCachedPhoto(photo, {scope, previousFaces, loadBlob, signal, read=readAnalysis}) {
  signal?.throwIfAborted();
  const key=analysisCacheKey(photo,scope,previousFaces), cached=await read(key,photo);
  signal?.throwIfAborted();
  if(cached)return {key,photo,cached};
  const blob=await loadBlob(); signal?.throwIfAborted(); return {key,photo,blob};
}
export async function finishCachedPhoto(prepared, {analyze, write=writeAnalysis, ...options}={}) {
  options.signal?.throwIfAborted();
  if(prepared.cached){options.onProgress?.("复用本机已完成的识别结果…");return prepared.cached;}
  const url=URL.createObjectURL(prepared.blob);
  try {
    const run=analyze || (await import("./faces.js")).analyzePhoto; let diagnostics;
    const faces=await run({url},{...options,onDiagnostics:data=>{diagnostics=data;}});
    options.signal?.throwIfAborted();
    await write(prepared.key,prepared.photo,faces,diagnostics);
    return {faces,diagnostics};
  } finally {URL.revokeObjectURL(url);}
}

// Only one future original is held, and rejected downloads are always observed.
export async function* prefetchOne(items, load, signal) {
  const start=i=>Promise.resolve().then(()=>{signal?.throwIfAborted();return load(items[i],i);}).then(value=>({value}),error=>({error}));
  let next=items.length?start(0):null;
  for(let i=0;i<items.length;i++){
    const current=await next; signal?.throwIfAborted();
    next=i+1<items.length?start(i+1):null;
    yield {...current,index:i,item:items[i]};
  }
}
