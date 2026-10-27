import { shareRequest, originalDownload } from "./westlake.js";
import { uploadStoredFile } from "./upload.js";
import { cosineSimilarity } from "./sface-utils.js";
import { faceKey } from "./people.js";
import { FUSION_ENGINE, FUSION_SIZE, FUSION_THRESHOLD as FACE_MATCH_THRESHOLD, fusionThreshold as normalizeMatchThreshold } from "./fusion-utils.js";

const INDEX = /^__run_faces_v4_([a-f0-9]{32})_([a-f0-9]{32})_([a-f0-9]{32})\.json$/i;
const LEGACY = /^__run_faces_v[23]_([a-f0-9]{32})_([a-f0-9]{32})_([a-f0-9]{32})\.json$/i;
export function faceIndexKey(file) { return `${file.docid}|${file.rev}`; }
export function needsFusionUpgrade(faces, detail) {
  return !faces || !(faces.engine === FUSION_ENGINE || detail?.engine === FUSION_ENGINE || (faces.length && faces.every(f => f.descriptor?.length === FUSION_SIZE)));
}
// Indices without diagnostics may also have silently skipped profile faces.
// A fresh diagnostic record has no pose-only rejection, so this is resumable.
export function needsFaceDetailsUpdate(detail) {
  return !detail || detail.rejected.some(face => face.reason === "侧脸角度过大");
}
export function validateFaceIndex(record, file) {
  const fusion=record?.version===4&&record.engine===FUSION_ENGINE;
  if (!fusion || record.docid !== file.docid || record.rev !== file.rev || !Array.isArray(record.faces) || record.faces.length > 200) throw new Error("人脸索引与当前模型或照片版本不一致，请补建融合索引");
  for (const face of record.faces) {
    if (!Array.isArray(face.descriptor) || face.descriptor.length !== FUSION_SIZE || face.descriptor.some(v => !Number.isFinite(v) || Math.abs(v) > 1.01) || Math.abs(Math.hypot(...face.descriptor)-1) > .01 ||
      !Array.isArray(face.box) || face.box.length !== 4 || face.box.some(v => !Number.isFinite(v)) ||
      typeof face.avatar !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(face.avatar) || face.avatar.length > 50000) throw new Error("人脸索引内容无效，请补建索引");
    if(fusion && (face.box[2]<=0 || face.box[3]<=0 || !Number.isFinite(face.detectorScore) || face.detectorScore<0 || face.detectorScore>1 || !Number.isFinite(face.sharpness) || face.sharpness<0 || (face.yawProxy!==null&&!Number.isFinite(face.yawProxy)) || !Array.isArray(face.landmarks) || face.landmarks.length!==5 || face.landmarks.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))) throw new Error("融合索引缺少有效姿态和质量信息，请升级索引");
  }
  return record.faces;
}
export function validateDiagnostics(data, accepted) {
  if (!data) return null;
  if (data.version !== 1 || data.accepted !== accepted || !Number.isInteger(data.totalDetected) || data.totalDetected < accepted ||
    !Array.isArray(data.rejected) || data.rejected.length + accepted > 200 || data.totalDetected < data.rejected.length + accepted) throw new Error("检测详情无效，请补充检测详情");
  for (const face of data.rejected) {
    if (!Array.isArray(face.box) || face.box.length !== 4 || !face.box.every(Number.isFinite) || face.box[2] <= 0 || face.box[3] <= 0 ||
      !["低置信度","人脸太小","关键点无效","侧脸角度过大","人脸模糊","未恢复关键点"].includes(face.reason) ||
      typeof face.avatar !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(face.avatar) || face.avatar.length > 50000) throw new Error("检测详情中的人脸信息无效");
  }
  return data;
}
export async function saveFaceIndex(session, rootDocid, file, faces, options = {}) {
  const record = { version: 4, engine: FUSION_ENGINE, docid: file.docid, rev: file.rev, faces };
  validateFaceIndex(record, file);
  if (options.diagnostics) record.diagnostics = validateDiagnostics(options.diagnostics, faces.length);
  const fileId = file.docid.split("/").at(-1);
  if (!/^[a-f0-9]{32}$/i.test(fileId) || !/^[a-f0-9]{32}$/i.test(file.rev) || !file.docid.startsWith(`${rootDocid}/`)) throw new Error("照片索引位置无效");
  const name = `__run_faces_v${record.version}_${fileId}_${file.rev}_${crypto.randomUUID().replaceAll("-", "")}.json`;
  const index = new File([JSON.stringify(record)], name, { type: "application/json" });
  if (index.size > 8 * 1024 * 1024) throw new Error("人脸索引过大，暂时无法保存");
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
    const versionKey = `${key}|4`;
    const prior = latest.get(versionKey);
    if (!prior || Number(file.create_time || file.modified || 0) > Number(prior.create_time || prior.modified || 0) ||
      (file.create_time === prior.create_time && file.name > prior.name)) latest.set(versionKey, file);
  }
  const result = new Map(), diagnostics = new Map(), warnings = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, photos.length) }, async () => {
    while (next < photos.length) {
      const photo = photos[next++];
      const prefix=`${photo.docid.split("/").at(-1).toUpperCase()}|${photo.rev.toUpperCase()}`;
      const candidates=[latest.get(`${prefix}|4`)].filter(Boolean);
      for(const file of candidates) {
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error("人脸索引过大");
        const url = await originalDownload(session.link, session.password, file, signal);
        const response = await fetch(url, { signal: signal || AbortSignal.timeout(30000), credentials: "omit", cache: "no-store" });
        if (!response.ok) throw new Error("人脸索引读取失败");
        const record = await response.json(), faces = validateFaceIndex(record, photo);
        const detail = validateDiagnostics(record.diagnostics, faces.length);
        Object.defineProperty(faces, "engine", { value: FUSION_ENGINE });
        result.set(faceIndexKey(photo), faces);
        if (detail) diagnostics.set(faceIndexKey(photo), detail);
        break;
      } catch (e) { if (signal?.aborted) throw e; warnings.push(photo.name); }
      }
    }
  }));
  const legacyKeys = photos.filter(photo => !result.has(faceIndexKey(photo)) && legacy.has(`${photo.docid.split("/").at(-1).toUpperCase()}|${photo.rev.toUpperCase()}`)).map(faceIndexKey);
  return { indices: result, diagnostics, warnings, legacyCount: legacyKeys.length, legacyKeys, files: listing.files };
}
export function referencePhotoIds(faces, indices, photos, threshold = FACE_MATCH_THRESHOLD, excluded = new Set()) {
  threshold = normalizeMatchThreshold(threshold);
  const found = [];
  for (const photo of photos) {
    const candidates = (indices.get(faceIndexKey(photo)) || []).filter((face, i) => !excluded.has(faceKey(photo, face, i)));
    if (faces.some(reference => candidates.some(face => cosineSimilarity(face.descriptor,reference.descriptor) >= threshold))) found.push(photo.docid);
  }
  return found;
}
