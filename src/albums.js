import { parseShare, shareRequest, originalDownload, isExpired } from "./westlake.js";
import { uploadStoredFile, uploadName } from "./upload.js";

const RECORD = /^__run_album_v1_(legacy|[a-f0-9]{32})_([a-f0-9]{32})\.json$/;
const PHOTO = /^__run_photo_([a-f0-9]{32})__/;
const ASSIGNMENT = /^__run_assignment_v1_[a-f0-9]{32}\.json$/;
const VISIBILITY = /^__run_visibility_v1_[a-f0-9]{32}\.json$/;
const id = () => crypto.randomUUID().replaceAll("-", "");
export function validateAlbumTitle(title) {
  const value = title.trim();
  if (!value || value.length > 80) throw new Error("请填写 1–80 字的相册名称");
  return value;
}
export function albumPhotoName(file, date, activity, albumId) {
  const name = uploadName(file, date, activity);
  if (!albumId || albumId === "legacy") return name;
  if (!/^[a-f0-9]{32}$/.test(albumId)) throw new Error("相册信息无效，请刷新后重新选择");
  const tagged = `__run_photo_${albumId}__${name}`;
  if (tagged.length > 255) throw new Error("照片文件名过长，请改名后选择");
  return tagged;
}
export function albumFiles(files, albumId, assignments = {}, visibility = {}, recycled = false) {
  return files.filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f.name) &&
    Boolean(visibility[f.docid]) === recycled &&
    (assignments[f.docid] || f.name.match(PHOTO)?.[1] || "legacy") === (albumId || "legacy"));
}
export function latestRecords(files) {
  const latest = new Map();
  for (const file of files) {
    const match = file.name.match(RECORD);
    if (!match) continue;
    const prior = latest.get(match[1]);
    const timestamp = Number(file.create_time || file.modified || 0);
    if (!prior || timestamp > Number(prior.create_time || prior.modified || 0) ||
      (timestamp === Number(prior.create_time || prior.modified || 0) && file.name > prior.name)) latest.set(match[1], file);
  }
  return [...latest.entries()];
}
export function sortAlbums(albums) {
  return [...albums].sort((a, b) => Date.parse(b.createdAt || "1970-01-01") - Date.parse(a.createdAt || "1970-01-01") || b.id.localeCompare(a.id));
}
function validRecord(record, albumId) {
  if (record?.version !== 1 || record.id !== albumId || typeof record.title !== "string" ||
    !record.title.trim() || record.title.length > 80 || !Number.isFinite(Date.parse(record.createdAt)) ||
    (record.date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(record.date))) throw new Error("相册信息无法读取，请刷新重试");
  return record;
}
export async function loadLibrary(sources, signal) {
  const groups = await Promise.all(sources.map(async source => {
    if (isExpired(source)) return [{ ...source, sourceId: source.id, albumId: "legacy" }];
    const session = { link: parseShare(source.url), password: source.accessPassword || "" };
    const info = await shareRequest(session.link, session.password, "get", {}, signal);
    if (info.size !== -1) return [{ ...source, sourceId: source.id, albumId: "legacy", canUpload: false }];
    const listing = await shareRequest(session.link, session.password, "listdir", { docid: info.docid, attr: [], by: "name", sort: "asc" }, signal);
    const records = [...latestRecords(listing.files), ...listing.files.filter(f => ASSIGNMENT.test(f.name) || VISIBILITY.test(f.name)).map(f => [null, f])];
    const metadata = [];
    const movements = [];
    const changes = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, records.length) }, async () => {
      while (next < records.length) {
        const [albumId, file] = records[next++];
        if (file.size > 32768) throw new Error("相册信息文件过大，无法读取");
        const url = await originalDownload(session.link, session.password, file, signal);
        const response = await fetch(url, { signal: signal || AbortSignal.timeout(30000), credentials: "omit", cache: "no-store" });
        if (!response.ok) throw new Error("相册信息读取失败，请刷新重试");
        const record = await response.json();
        if (albumId) metadata.push(validRecord(record, albumId));
        else if (VISIBILITY.test(file.name)) {
          validateVisibility(record, info.docid);
          changes.push({ ...record, file });
        } else {
          if (record?.version !== 1 || !/^(legacy|[a-f0-9]{32})$/.test(record.albumId) || !Array.isArray(record.docids) || record.docids.length > 100 ||
            record.docids.some(d => typeof d !== "string" || !d.startsWith(`${info.docid}/`))) throw new Error("照片分类信息无效，请刷新重试");
          movements.push({ ...record, file });
        }
      }
    }));
    if (!metadata.some(m => m.id === "legacy")) metadata.push({ id: "legacy", title: source.title, date: source.date || "", createdAt: "1970-01-01T00:00:00Z" });
    const assignments = resolveAssignments(movements);
    const visibility = resolveVisibility(changes);
    return metadata.filter(record => !record.archived).map(record => ({ ...source, ...record, id: `${source.id}:${record.id}`, sourceId: source.id,
      albumId: record.id, activity: record.title, rootDocid: info.docid, canUpload: Boolean(info.perm & 4),
      assignments, visibility, photoCount: albumFiles(listing.files, record.id, assignments, visibility).length,
      recycledCount: albumFiles(listing.files, record.id, assignments, visibility, true).length,
      description: record.id === "legacy" ? "原有照片" : "活动照片 · 原图存于学校网盘" }));
  }));
  return sortAlbums(groups.flat());
}
function validateVisibility(record, rootDocid) {
  if (record?.version !== 1 || typeof record.deleted !== "boolean" || !Array.isArray(record.docids) ||
    !record.docids.length || record.docids.length > 100 || record.docids.some(d => typeof d !== "string" || !d.startsWith(`${rootDocid}/`))) {
    throw new Error("照片回收站记录无效，请刷新重试");
  }
}
export function resolveVisibility(changes) {
  const result = {};
  for (const record of [...changes].sort((a, b) => Number(a.file.create_time || a.file.modified || 0) - Number(b.file.create_time || b.file.modified || 0) || a.file.name.localeCompare(b.file.name))) {
    for (const docid of record.docids) result[docid] = record.deleted;
  }
  return result;
}
// Share links cannot call the authenticated file/delete endpoint. Append shared
// visibility records instead, keeping originals and face indices recoverable.
export async function setPhotosDeleted(source, docids, deleted, options = {}) {
  const record = { version: 1, deleted, docids: [...new Set(docids)] };
  const session = { link: parseShare(source.url), password: source.accessPassword || "" };
  const info = await shareRequest(session.link, session.password, "get", {}, options.signal);
  if (!(info.perm & 4) || info.size !== -1) throw new Error("当前分享没有保存删除或恢复记录的权限");
  validateVisibility(record, info.docid);
  const folders = [...new Set(record.docids.map(d => d.slice(0, d.lastIndexOf("/"))))];
  const listings = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, folders.length) }, async () => {
    while (next < folders.length) {
      const docid = folders[next++];
      listings.push(await shareRequest(session.link, session.password, "listdir", { docid, attr: [], by: "name", sort: "asc" }, options.signal));
    }
  }));
  // Only existing photos are eligible; metadata files must never be recycled.
  const photos = new Set(listings.flatMap(listing => listing.files).filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f.name)).map(f => f.docid));
  if (record.docids.some(d => !photos.has(d))) throw new Error("所选照片已不存在，请刷新后重试");
  const name = `__run_visibility_v1_${id()}.json`;
  const file = new File([JSON.stringify(record)], name, { type: "application/json" });
  if (file.size > 32768) throw new Error("删除记录过大，请减少所选照片数量");
  await uploadStoredFile(session, info.docid, file, name, options);
}
export function resolveAssignments(movements) {
  const result = {};
  for (const record of [...movements].sort((a, b) => Number(a.file.create_time || a.file.modified || 0) - Number(b.file.create_time || b.file.modified || 0) || a.file.name.localeCompare(b.file.name))) {
    for (const docid of record.docids) result[docid] = record.albumId;
  }
  return result;
}
export async function assignPhotos(source, albumId, docids, options = {}) {
  if (!/^(legacy|[a-f0-9]{32})$/.test(albumId) || !docids.length || docids.length > 100) throw new Error("请选择 1–100 张照片和目标相册");
  const session = { link: parseShare(source.url), password: source.accessPassword || "" };
  const info = await shareRequest(session.link, session.password, "get", {}, options.signal);
  if (!(info.perm & 4) || info.size !== -1) throw new Error("当前分享没有保存分类的权限");
  if (docids.some(d => typeof d !== "string" || !d.startsWith(`${info.docid}/`))) throw new Error("所选照片不属于当前相册存储位置");
  const name = `__run_assignment_v1_${id()}.json`;
  const file = new File([JSON.stringify({ version: 1, albumId, docids })], name, { type: "application/json" });
  await uploadStoredFile(session, info.docid, file, name, options);
}
export async function saveAlbum(source, title, date, existing, options = {}) {
  const albumId = existing?.albumId || id();
  const record = { version: 1, id: albumId, title: validateAlbumTitle(title), date: date || "", createdAt: existing?.createdAt || new Date().toISOString(), archived: Boolean(existing?.archived) };
  validRecord(record, albumId);
  const session = { link: parseShare(source.url), password: source.accessPassword || "" };
  const info = await shareRequest(session.link, session.password, "get", {}, options.signal);
  if (!(info.perm & 4) || info.size !== -1) throw new Error("当前分享没有创建相册权限，请检查网盘的上传权限");
  const name = `__run_album_v1_${albumId}_${id()}.json`;
  const file = new File([JSON.stringify(record)], name, { type: "application/json" });
  await uploadStoredFile(session, info.docid, file, name, options);
  return `${source.id}:${albumId}`;
}
