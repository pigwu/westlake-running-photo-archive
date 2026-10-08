import { shareRequest } from "./westlake.js";

export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export function todayShanghai(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = type => parts.find(p => p.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function validatePhoto(file) {
  if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name)) throw new Error("仅支持 JPG、PNG、WebP、GIF 照片");
  if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) throw new Error("单张照片应大于 0 字节且不超过 50 MB");
}
export function uploadName(file, date, activity) {
  validatePhoto(file);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("请填写有效的拍摄日期");
  const label = activity.trim();
  if (/[\\/:*?"<>|_]/.test(label) || label.length > 40) throw new Error("活动名称最多 40 字，不能含下划线或路径符号");
  const name = label ? `${date}_${label}__${file.name}` : `${date}__${file.name}`;
  if (/[\\/:*?"<>|]/.test(name) || name.length > 255) throw new Error("照片文件名过长或含网盘不支持的符号，请改名后选择");
  return name;
}
export function photoLabel(name) {
  name = name.replace(/^__run_photo_[a-f0-9]{32}__/, "");
  const match = name.match(/^(\d{4}-\d{2}-\d{2})(?:_([^_]+))?__(.+)$/);
  return match ? { date: match[1], activity: match[2] || "", originalName: match[3] } : { date: "", activity: "", originalName: name };
}
export function uploadTransport(authrequest, file) {
  if (!Array.isArray(authrequest) || !["POST", "PUT"].includes(authrequest[0])) throw new Error("网盘未返回可用的上传请求");
  const [method, address, ...fields] = authrequest;
  const url = new URL(address);
  if (url.protocol !== "https:" || url.hostname !== "driveoss.westlake.edu.cn" || url.username || url.password) throw new Error("上传地址无法验证");
  const headers = {};
  const form = method === "POST" ? new FormData() : null;
  for (const field of fields) {
    if (typeof field !== "string" || !field.includes(": ")) throw new Error("网盘上传字段格式错误");
    const colon = field.indexOf(": ");
    const name = field.slice(0, colon), value = field.slice(colon + 2);
    if (name.toLowerCase() === "date") continue;
    if (method === "PUT") {
      if (!["content-type", "x-ms-blob-type"].includes(name.toLowerCase())) throw new Error("网盘返回了不支持的上传请求头");
      headers[name] = value;
    } else form.append(name, value);
  }
  if (form) form.append("file", file, file.name);
  return { method, url: url.href, headers, body: form || file };
}
function sendOriginal(transport, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const cancel = () => request.abort();
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    if (signal?.aborted) { reject(new DOMException("上传已取消", "AbortError")); return; }
    request.open(transport.method, transport.url);
    request.timeout = 10 * 60 * 1000;
    Object.entries(transport.headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 95)); };
    request.onload = () => { cleanup(); request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`原图传输失败（${request.status}），请重试`)); };
    request.onerror = () => { cleanup(); reject(new Error("照片传输无法连接学校网盘，请检查网络后重试")); };
    request.ontimeout = () => { cleanup(); reject(new Error("上传超时，请重试")); };
    request.onabort = () => { cleanup(); reject(new DOMException("上传已取消", "AbortError")); };
    signal?.addEventListener("abort", cancel, { once: true });
    request.send(transport.body);
  });
}
export async function uploadPhoto(session, folder, file, name, options = {}) {
  validatePhoto(file);
  return uploadStoredFile(session, folder, file, name, options);
}
export async function uploadStoredFile(session, folder, file, name, { signal, onProgress = () => {}, transfer = sendOriginal } = {}) {
  if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) throw new Error("文件大小不符合上传要求");
  const started = await shareRequest(session.link, session.password, "osbeginupload", {
    docid: folder, name, length: file.size, client_mtime: (file.lastModified || Date.now()) * 1000,
    ondup: 1, reqmethod: "POST", usehttps: true,
  }, signal);
  if (!started.docid || !started.rev) throw new Error("网盘未创建上传任务");
  const transport = uploadTransport(started.authrequest, file);
  await transfer(transport, signal, onProgress);
  onProgress(96);
  const completed = await shareRequest(session.link, session.password, "osendupload", { docid: started.docid, rev: started.rev }, signal);
  onProgress(100);
  return { ...completed, docid: started.docid, rev: started.rev, name: started.name || name, size: file.size };
}
