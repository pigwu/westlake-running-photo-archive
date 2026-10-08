import { shareRequest, originalDownload } from "./westlake.js";
import { uploadStoredFile } from "./upload.js";
import { FACE_ENGINE, FEATURE_SIZE, cosineSimilarity, FACE_MATCH_THRESHOLD } from "./sface-utils.js";

const INDEX = /^__run_faces_v3_([a-f0-9]{32})_([a-f0-9]{32})_([a-f0-9]{32})\.json$/i;
const LEGACY = /^__run_faces_v2_([a-f0-9]{32})_([a-f0-9]{32})_([a-f0-9]{32})\.json$/i;
export function faceIndexKey(file) { return `${file.docid}|${file.rev}`; }
export function validateFaceIndex(record, file) {
  if (record?.version !== 3 || record.engine !== FACE_ENGINE || record.docid !== file.docid || record.rev !== file.rev || !Array.isArray(record.faces) || record.faces.length > 200) throw new Error("人脸索引与当前模型或照片版本不一致，请补建");
  for (const face of record.faces) {
    if (!Array.isArray(face.descriptor) || face.descriptor.length !== FEATURE_SIZE || face.descriptor.some(v => !Number.isFinite(v) || Math.abs(v) > 1.01) || Math.abs(Math.hypot(...face.descriptor)-1) > .01 ||
      !Array.isArray(face.box) || face.box.length !== 4 || face.box.some(v => !Number.isFinite(v)) ||
      typeof face.avatar !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(face.avatar) || face.avatar.length > 50000) throw new Error("人脸索引内容无效，请补建索引");
  }
  return record.faces;
}
export async function saveFaceIndex(session, rootDocid, file, faces, options = {}) {
  const record = { version: 3, engine: FACE_ENGINE, docid: file.docid, rev: file.rev, faces };
  validateFaceIndex(record, file);
  const fileId = file.docid.split("/").at(-1);
  if (!/^[a-f0-9]{32}$/i.test(fileId) || !/^[a-f0-9]{32}$/i.test(file.rev) || !file.docid.startsWith(`${rootDocid}/`)) throw new Error("照片索引位置无效");
  const name = `__run_faces_v3_${fileId}_${file.rev}_${crypto.randomUUID().replaceAll("-", "")}.json`;
  const index = new File([JSON.stringify(record)], name, { type: "application/json" });
  if (index.size > 1024 * 1024) throw new Error("人脸索引过大，暂时无法保存");
  await uploadStoredFile(session, rootDocid, index, name, options);
}
export async function loadFaceIndices(session, rootDocid, photos, signal) {
  const listing = await shareRequest(session.link, session.password, "listdir", { docid: rootDocid, attr: [], by: "name", sort: "asc" }, signal);
  const latest = new Map(), legacy = new Set();
  for (const file of listing.files) {
    const old = file.name.match(LEGACY);
    if (old) legacy.add(`${old[1].toUpperCase()}|${old[2].toUpperCase()}`);
    const match = file.name.match(INDEX);
    if (!match) continue;
    const key = `${match[1].toUpperCase()}|${match[2].toUpperCase()}`;
    const prior = latest.get(key);
    if (!prior || Number(file.create_time || file.modified || 0) > Number(prior.create_time || prior.modified || 0) ||
      (file.create_time === prior.create_time && file.name > prior.name)) latest.set(key, file);
  }
  const result = new Map(), warnings = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, photos.length) }, async () => {
    while (next < photos.length) {
      const photo = photos[next++];
      const file = latest.get(`${photo.docid.split("/").at(-1).toUpperCase()}|${photo.rev.toUpperCase()}`);
      if (!file) continue;
      try {
        if (file.size > 1024 * 1024) throw new Error("人脸索引过大");
        const url = await originalDownload(session.link, session.password, file, signal);
        const response = await fetch(url, { signal: signal || AbortSignal.timeout(30000), credentials: "omit", cache: "no-store" });
        if (!response.ok) throw new Error("人脸索引读取失败");
        result.set(faceIndexKey(photo), validateFaceIndex(await response.json(), photo));
      } catch (e) { if (signal?.aborted) throw e; warnings.push(photo.name); }
    }
  }));
  const legacyKeys = photos.filter(photo => !result.has(faceIndexKey(photo)) && legacy.has(`${photo.docid.split("/").at(-1).toUpperCase()}|${photo.rev.toUpperCase()}`)).map(faceIndexKey);
  return { indices: result, warnings, legacyCount: legacyKeys.length, legacyKeys };
}
export function referencePhotoIds(faces, indices, photos) {
  const found = [];
  for (const photo of photos) {
    const candidates = indices.get(faceIndexKey(photo)) || [];
    if (faces.some(reference => candidates.some(face => cosineSimilarity(face.descriptor,reference.descriptor) >= FACE_MATCH_THRESHOLD))) found.push(photo.docid);
  }
  return found;
}
