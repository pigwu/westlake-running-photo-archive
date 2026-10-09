import { shareRequest, originalPhotoBlob } from "./westlake.js";

// Keep full-resolution downloads/decodes serial, including across albums.
let originalQueue = Promise.resolve();
async function resizePreview(blob, signal) {
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob), image = new Image();
  const canvas = document.createElement("canvas");
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener("abort", cancel); };
      const cancel = () => { cleanup(); image.src = ""; reject(signal.reason || new DOMException("预览已取消", "AbortError")); };
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error("原图无法解码，可尝试下载原图查看")); };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel(); else image.src = url;
    });
    signal?.throwIfAborted();
    const scale = Math.min(1, 1200 / image.naturalWidth, 900 / image.naturalHeight);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法生成预览，可下载原图查看");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const preview = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .85));
    signal?.throwIfAborted();
    if (!preview) throw new Error("预览生成失败，可下载原图查看");
    return preview;
  } finally { image.src = ""; URL.revokeObjectURL(url); canvas.width = canvas.height = 0; }
}

export async function photoPreviewBlob(session, file, signal, { onFallback = () => {}, resize = resizePreview } = {}) {
  try {
    return await shareRequest(session.link, session.password, "thumbnail", { docid: file.docid, rev: file.rev, height: 900, width: 1200, quality: 85 }, signal);
  } catch (error) {
    signal?.throwIfAborted();
    // Permission/expiry failures must remain visible; only the preview-size
    // failure gets a fallback using the share's normal download permission.
    if (Number(error.code) !== 403023) throw error;
    if (file.size > 50 * 1024 * 1024) throw new Error("照片超过在线预览限制且大于 50 MB，请下载原图查看");
    onFallback();
    const job = originalQueue.then(async () => {
      signal?.throwIfAborted();
      const original = await originalPhotoBlob(session, file, signal);
      return resize(original, signal);
    });
    originalQueue = job.catch(() => {});
    return job;
  }
}
