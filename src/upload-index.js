import { uploadPhoto } from "./upload.js";
import { saveFaceIndex } from "./face-cache.js";

export async function uploadPhotoWithIndex(session, folder, rootDocid, file, name, { signal, onProgress, onPhotoStored = () => {}, onIndexProgress = () => {}, transfer, indexTransfer, analyze } = {}) {
  const stored = await uploadPhoto(session, folder, file, name, { signal, onProgress, transfer });
  onPhotoStored(stored);
  let url;
  try {
    url = URL.createObjectURL(file);
    const analyzePhoto = analyze || (await import("./faces.js")).analyzePhoto;
    const faces = await analyzePhoto({ url }, { signal, onProgress: onIndexProgress });
    onIndexProgress("保存共享人脸索引…");
    await saveFaceIndex(session, rootDocid, stored, faces, { signal, transfer: indexTransfer });
    return { stored, indexed: true, faceCount: faces.length };
  } catch (e) {
    // Original bytes have already been committed; an index failure must not
    // cause an upload retry or incorrectly mark the original as missing.
    return { stored, indexed: false, indexError: e.message, stopped: Boolean(signal?.aborted) };
  } finally { if (url) URL.revokeObjectURL(url); }
}
