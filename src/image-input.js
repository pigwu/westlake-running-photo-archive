// School storage serves original images as application/octet-stream. Identify
// the bytes rather than trusting its Content-Type or the filename extension.
export async function normalizeImageBlob(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const starts = signature => signature.every((byte, i) => bytes[i] === byte);
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  let type;
  if (starts([255, 216, 255])) type = "image/jpeg";
  else if (starts([137, 80, 78, 71, 13, 10, 26, 10])) type = "image/png";
  else if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) type = "image/gif";
  else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") type = "image/webp";
  else if (starts([66, 77])) type = "image/bmp";
  else if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) type = "image/avif";
  if (!type) throw new Error("原图内容不是支持的图片（JPG、PNG、WebP、GIF、BMP 或 AVIF）");
  return blob.type === type ? blob : blob.slice(0, blob.size, type);
}

export async function loadAnalysisImage(url, signal) {
  signal?.throwIfAborted();
  const response = await fetch(url, { credentials: "omit", signal });
  if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
  const blob = await normalizeImageBlob(await response.blob());
  signal?.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        image.onload = null; image.onerror = null;
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => { cleanup(); image.src = ""; reject(signal.reason || new DOMException("分析已停止", "AbortError")); };
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error("图片无法解码，请检查原图是否损坏或转换为 JPG/PNG 后重试")); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else image.src = objectUrl;
    });
    return image;
  } finally { URL.revokeObjectURL(objectUrl); }
}
