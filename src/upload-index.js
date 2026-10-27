import { uploadPhoto } from "./upload.js";
import { prepareCachedPhoto, finishCachedPhoto } from "./analysis-cache.js";
import { saveFaceIndex } from "./face-cache.js";

export async function uploadPhotoWithIndex(session, folder, rootDocid, file, name, { signal, onProgress, onPhotoStored = () => {}, onIndexProgress = () => {}, transfer, indexTransfer, analyze, buildIndex = true } = {}) {
  const stored = await uploadPhoto(session, folder, file, name, { signal, onProgress, transfer });
  onPhotoStored(stored);
  if (!buildIndex) return { stored, indexed:false, deferred:true };
  try {
    const prepared = await prepareCachedPhoto(stored, {scope:session.link,signal,loadBlob:async()=>file});
    const {faces,diagnostics} = await finishCachedPhoto(prepared, {signal,analyze,onProgress:onIndexProgress});
    onIndexProgress("保存共享人脸索引…");
    await saveFaceIndex(session, rootDocid, stored, faces, { signal, transfer: indexTransfer, diagnostics });
    return { stored, indexed: true, faceCount: faces.length };
  } catch (e) {
    // Original bytes have already been committed; an index failure must not
    // cause an upload retry or incorrectly mark the original as missing.
    return { stored, indexed: false, indexError: e.message, stopped: Boolean(signal?.aborted) };
  }
}
