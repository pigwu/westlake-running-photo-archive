const ORIGIN = "https://pan.westlake.edu.cn";
export function parseShare(url) {
  const parsed = new URL(url);
  if (parsed.origin !== ORIGIN) throw new Error("请使用学校网盘的 HTTPS 分享链接");
  const match = (parsed.hash ? parsed.hash.slice(1) : parsed.pathname).match(/^\/link\/([A-Fa-f0-9]{32})\/?$/);
  if (!match) throw new Error("分享链接格式不正确");
  return match[1];
}
export function isExpired(album, now = Date.now()) {
  return Boolean(album.expiresAt && Date.parse(album.expiresAt) <= now);
}
export async function originalDownload(link, password, file, signal) {
  const data = await shareRequest(link, password, "osdownload", {
    docid: file.docid, usehttps: true, savename: file.name,
  }, signal);
  if (data.authrequest?.[0] !== "GET" || typeof data.authrequest?.[1] !== "string") {
    throw new Error("网盘未提供原图下载地址，请检查分享的下载权限");
  }
  const url = new URL(data.authrequest[1]);
  if (url.protocol !== "https:" || url.hostname !== "driveoss.westlake.edu.cn" || url.username || url.password) {
    throw new Error("网盘返回了无法验证的下载地址");
  }
  return url.href;
}
export async function shareRequest(link, password, method, fields = {}, signal) {
  // Matches the school's own web client. text/plain avoids a CORS preflight.
  const response = await fetch(`${ORIGIN}/api/v1/link?method=${method}`, {
    method: "POST", credentials: "omit", cache: "no-store",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ link, password, ...fields }),
    signal: signal || AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const messages = { 401002: "分享密码不正确", 401030: "分享访问次数已用完", 403002: "此目录没有上传权限", 403039: "同名照片已存在，请改名后上传；原文件未覆盖", 403040: "同名文件已存在，且无权操作；请改名后上传", 403041: "同名目录已存在，请改名后上传", 403001: "网盘空间不足，无法上传", 404008: "分享不存在或已到期" };
    const failure = new Error(messages[error.errcode] || (method.includes("upload") ? `网盘上传失败（${response.status}），请检查分享期限、上传权限或同名文件` : `网盘无法读取（${response.status}），请检查分享期限和预览权限`));
    failure.code = error.errcode;
    throw failure;
  }
  if (method === "thumbnail") {
    // The service labels JPEG bytes as JSON; use bytes, never response.json().
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!(bytes[0] === 255 && bytes[1] === 216) && !(bytes[0] === 137 && bytes[1] === 80)) {
      throw new Error("网盘未返回可用缩略图，请在网盘中打开原图");
    }
    return new Blob([bytes], { type: bytes[0] === 255 ? "image/jpeg" : "image/png" });
  }
  return response.json();
}
