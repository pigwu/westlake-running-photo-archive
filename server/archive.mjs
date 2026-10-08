import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
export const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
export function safeSegment(value) {
  return (
    String(value || "未命名活动")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 80) || "未命名活动"
  );
}
export function archivePath(root, date, event, extension) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error("日期格式无效");
  if (!imageExtensions.has(extension.toLowerCase()))
    throw new Error("仅支持 JPG、PNG 和 WebP 图片");
  return path.join(
    root,
    date.slice(0, 4),
    `${date}_${safeSegment(event)}`,
    `${randomUUID()}${extension.toLowerCase()}`,
  );
}
export function hashFile(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
export function faceDistance(a, b) {
  if (a.length !== 128 || b.length !== 128) return Infinity;
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}
export function within(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== "" &&
    !relative.startsWith(".." + path.sep) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}
