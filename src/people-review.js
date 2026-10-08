import { shareRequest, originalDownload } from "./westlake.js";
import { uploadStoredFile } from "./upload.js";
const RECORD = /^__run_people_v1_(legacy|[a-f0-9]{32})_[a-f0-9]{32}\.json$/;
const PERSON = /^[a-f0-9]{32}$/;
export function validateReview(record, root, albumId) {
  if (record?.version !== 1 || record.albumId !== albumId || !/^(legacy|[a-f0-9]{32})$/.test(albumId) ||
    !["assign", "ignore", "reset"].includes(record.action) || !Array.isArray(record.faceKeys) || !record.faceKeys.length || record.faceKeys.length > 500 ||
    (record.action === "assign" && (!PERSON.test(record.personId) || typeof record.name !== "string" || record.name.length > 60))) throw new Error("人物纠错记录无效");
  for (const key of record.faceKeys) {
    let parts;
    try { parts = JSON.parse(key); } catch { throw new Error("人物纠错记录的人脸位置无效"); }
    if (!Array.isArray(parts) || parts.length !== 6 || typeof parts[0] !== "string" || !parts[0].startsWith(`${root}/`) ||
      typeof parts[1] !== "string" || !parts[1] || !parts.slice(2).every(Number.isFinite) || parts[4] <= 0 || parts[5] <= 0) throw new Error("人物纠错记录不属于当前照片存储位置");
  }
  return record;
}
export function resolveReviews(records) {
  const assignments = {}, names = {};
  for (const record of [...records].sort((a, b) => Number(a.file.create_time || a.file.modified || 0) - Number(b.file.create_time || b.file.modified || 0) || a.file.name.localeCompare(b.file.name))) {
    for (const key of record.faceKeys) {
      if (record.action === "reset") delete assignments[key];
      else assignments[key] = record.action === "ignore" ? "ignore" : record.personId;
    }
    if (record.action === "assign" && record.name.trim()) names[record.personId] = record.name.trim();
  }
  return { assignments, names };
}
export async function loadReviews(session, root, albumId, signal, files) {
  files ||= (await shareRequest(session.link, session.password, "listdir", { docid: root, attr: [], by: "name", sort: "asc" }, signal)).files;
  const selected = files.filter(f => f.name.match(RECORD)?.[1] === albumId), records = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
    while (next < selected.length) {
      const file = selected[next++];
      if (file.size > 131072) throw new Error("人物纠错记录过大");
      const url = await originalDownload(session.link, session.password, file, signal);
      const response = await fetch(url, { signal: signal || AbortSignal.timeout(30000), credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error("共享人物纠错记录读取失败，请刷新重试");
      const record = validateReview(await response.json(), root, albumId);
      records.push({ ...record, file });
    }
  }));
  return resolveReviews(records);
}
export async function saveReview(session, root, albumId, change, options = {}) {
  const record = validateReview({ ...change, faceKeys: [...new Set(change.faceKeys)], version: 1, albumId }, root, albumId);
  const info = await shareRequest(session.link, session.password, "get", {}, options.signal);
  if (info.docid !== root || info.size !== -1 || !(info.perm & 4)) throw new Error("当前分享没有保存人物纠错记录的权限");
  const name = `__run_people_v1_${albumId}_${crypto.randomUUID().replaceAll("-", "")}.json`;
  const file = new File([JSON.stringify(record)], name, { type: "application/json" });
  if (file.size > 131072) throw new Error("本次选择的人脸过多，请分批保存");
  await uploadStoredFile(session, root, file, name, options);
}
