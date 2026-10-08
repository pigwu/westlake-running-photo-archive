import { originalDownload } from "./westlake.js";
import { photoLabel, MAX_PHOTO_BYTES } from "./upload.js";

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException("下载已取消", "AbortError");
}
export function downloadName(name) {
  const clean = String(name || "照片").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 160) || "照片";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? "_" + clean : clean;
}
async function availableName(raw, directory, used, signal) {
  const name = downloadName(photoLabel(raw).originalName), dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; ; i++) {
    checkAbort(signal);
    const candidate = i === 1 ? name : base + " (" + i + ")" + ext;
    if (used.has(candidate.toLowerCase())) continue;
    if (directory) {
      try { await directory.getFileHandle(candidate); continue; }
      catch (e) { if (e.name === "TypeMismatchError") continue; if (e.name !== "NotFoundError") throw e; }
    }
    used.add(candidate.toLowerCase()); return candidate;
  }
}

export async function downloadPhotos(session, files, { directory, saveBlob, signal, onProgress = () => {} } = {}) {
  checkAbort(signal);
  if (!files.length || files.length > 100) throw new Error("请每批选择 1–100 张照片");
  if (!directory && !saveBlob) throw new Error("浏览器无法保存文件");
  const used = new Set(), failed = []; let completed = 0;
  for (const file of files) {
    let writer, reader, createdName;
    try {
      checkAbort(signal);
      const name = await availableName(file.name, directory, used, signal);
      onProgress({ completed, total: files.length, failed: failed.length, name });
      const url = await originalDownload(session.link, session.password, file, signal);
      const response = await fetch(url, { credentials: "omit", signal: signal || AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error("原图下载失败（" + response.status + "）");
      if (!response.body) throw new Error("浏览器无法读取原图");
      reader = response.body.getReader();
      const chunks = []; let bytes = 0;
      if (directory) {
        checkAbort(signal);
        const handle = await directory.getFileHandle(name, { create: true });
        createdName = name;
        writer = await handle.createWritable();
      }
      while (true) {
        checkAbort(signal);
        const { value, done } = await reader.read();
        checkAbort(signal);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_PHOTO_BYTES) throw new Error("单张原图超过 50 MB，请使用单张下载");
        if (writer) await writer.write(value); else chunks.push(value);
      }
      if (!bytes) throw new Error("原图为空");
      checkAbort(signal);
      if (writer) { await writer.close(); writer = null; }
      else await saveBlob(new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" }), name);
      completed++;
    } catch (e) {
      if (writer) await writer.abort().catch(() => {});
      if (createdName) await directory.removeEntry(createdName).catch(() => {});
      if (signal?.aborted) { e.completed = completed; throw e; }
      failed.push({ name: photoLabel(file.name).originalName, error: e.message });
    } finally {
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  }
  return { completed, failed };
}
