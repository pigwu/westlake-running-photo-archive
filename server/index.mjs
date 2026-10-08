import express from "express";
import multer from "multer";
import sharp from "sharp";
import exifr from "exifr";
import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import {
  archivePath,
  hashFile,
  faceDistance,
  imageExtensions,
  within,
} from "./archive.mjs";
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.resolve(process.env.DATA_DIR || path.join(base, "data"));
await fs.mkdir(path.join(data, "thumbnails"), { recursive: true });
const db = new DatabaseSync(path.join(data, "archive.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,name TEXT NOT NULL,date TEXT NOT NULL,eventId TEXT REFERENCES events(id),file TEXT,hash TEXT UNIQUE,size INTEGER DEFAULT 0,width INTEGER DEFAULT 0,height INTEGER DEFAULT 0,favorite INTEGER DEFAULT 0,trash INTEGER DEFAULT 0,analyzed INTEGER DEFAULT 0,created TEXT NOT NULL,demo INTEGER DEFAULT 0,tags TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,name TEXT NOT NULL,descriptor TEXT NOT NULL,avatar TEXT);
CREATE TABLE IF NOT EXISTS faces(id TEXT PRIMARY KEY,photoId TEXT REFERENCES photos(id),personId TEXT REFERENCES people(id),descriptor TEXT NOT NULL,box TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS faces_photo ON faces(photoId);
CREATE INDEX IF NOT EXISTS faces_person ON faces(personId);
`);
const setting = (key, fallback) =>
  db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value ??
  fallback;
const setSetting = (key, value) =>
  db
    .prepare(
      "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, value);
const root = () =>
  process.env.PHOTO_ROOT || setting("photoRoot", path.join(data, "originals"));
await fs.mkdir(root(), { recursive: true });
if (
  !db.prepare("SELECT id FROM photos LIMIT 1").get() &&
  !db.prepare("SELECT id FROM events LIMIT 1").get()
) {
  const events = [
    [
      "demo-autumn",
      "秋日环湖 · 一起跑过十公里",
      "2026-10-04",
      "西湖 · 苏堤",
      "风刚好，步频刚好，大家也都刚好在。",
    ],
    [
      "demo-morning",
      "周末晨跑计划",
      "2026-09-27",
      "校园 · 田径场",
      "把周末的第一束光收入相册。",
    ],
    [
      "demo-trail",
      "山野之间 · 九溪越野",
      "2026-09-19",
      "九溪 · 龙井",
      "沿着山路，找回自己的节奏。",
    ],
    [
      "demo-night",
      "城市夜跑",
      "2026-09-12",
      "钱塘江 · 滨江绿道",
      "晚风和江岸，都是我们的跑道。",
    ],
  ];
  for (const e of events)
    db.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(...e);
  for (let i = 0; i < 15; i++) {
    const e = events[i < 7 ? 0 : i < 10 ? 1 : i < 13 ? 2 : 3];
    db.prepare(
      "INSERT INTO photos(id,name,date,eventId,file,created,demo,favorite,width,height) VALUES(?,?,?,?,?,?,1,?,1600,1067)",
    ).run(
      `demo-${i + 1}`,
      `RUN_${String(i + 1).padStart(4, "0")}.jpg`,
      e[2],
      e[0],
      `demo/${i + 1}.jpg`,
      new Date().toISOString(),
      [0, 3, 8, 11].includes(i) ? 1 : 0,
    );
  }
}
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "3mb" }));
const token = process.env.ARCHIVE_TOKEN;
const viewerToken = process.env.VIEWER_TOKEN;
if (viewerToken && (!token || viewerToken === token))
  throw new Error("VIEWER_TOKEN 需要与 ARCHIVE_TOKEN 不同，且两者同时配置");
const digest = (v) => createHash("sha256").update(v).digest();
const sessionKey = token
  ? createHash("sha256")
      .update("stride-session:" + token)
      .digest("hex")
  : null;
const viewerSessionKey = viewerToken
  ? createHash("sha256")
      .update("stride-viewer-session:" + viewerToken)
      .digest("hex")
  : null;
const attempts = new Map();
app.post("/api/login", (req, res) => {
  if (!token) return res.json({ ok: true });
  const entry = attempts.get(req.ip) || { count: 0, until: Date.now() + 60000 };
  if (Date.now() > entry.until) {
    entry.count = 0;
    entry.until = Date.now() + 60000;
  }
  entry.count++;
  attempts.set(req.ip, entry);
  if (entry.count > 10)
    return res.status(429).json({ error: "尝试过于频繁，请一分钟后再试" });
  const isAdmin =
    typeof req.body.token === "string" &&
    timingSafeEqual(digest(req.body.token), digest(token));
  const isViewer =
    typeof req.body.token === "string" &&
    viewerToken &&
    timingSafeEqual(digest(req.body.token), digest(viewerToken));
  if (!isAdmin && !isViewer)
    return res.status(401).json({ error: "访问口令不正确" });
  res.cookie("stride_session", isAdmin ? sessionKey : viewerSessionKey, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.secure || process.env.COOKIE_SECURE === "1",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true, role: isAdmin ? "admin" : "viewer" });
});
app.post("/api/logout", (req, res) => {
  res.clearCookie("stride_session", { httpOnly: true, sameSite: "strict" });
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => {
  req.role = "admin";
  if (token) {
    const supplied = req.headers.authorization?.replace(/^Bearer /, "");
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("stride_session="))
      ?.slice(15);
    const isAdmin =
      (supplied && timingSafeEqual(digest(supplied), digest(token))) ||
      cookie === sessionKey;
    const isViewer =
      viewerToken &&
      ((supplied && timingSafeEqual(digest(supplied), digest(viewerToken))) ||
        cookie === viewerSessionKey);
    if (!isAdmin && !isViewer)
      return res.status(401).json({ error: "请输入档案访问口令" });
    req.role = isAdmin ? "admin" : "viewer";
  }
  if (req.role === "viewer" && !["GET", "HEAD", "OPTIONS"].includes(req.method))
    return res
      .status(403)
      .json({ error: "当前为浏览权限，请使用管理员口令整理照片" });
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  )
    return res.status(403).json({ error: "不允许跨站修改档案" });
  next();
});
const photoSelect = `SELECT p.*,e.title eventTitle,e.location FROM photos p LEFT JOIN events e ON p.eventId=e.id`;
function publicPhoto(row) {
  return {
    ...row,
    file: undefined,
    hash: undefined,
    tags: JSON.parse(row.tags),
    favorite: !!row.favorite,
    trash: !!row.trash,
    demo: !!row.demo,
    analyzed: !!row.analyzed,
    url: row.demo ? "/" + row.file : `/api/photos/${row.id}/file`,
    thumb: row.demo ? "/" + row.file : `/api/photos/${row.id}/thumbnail`,
    people: db
      .prepare(
        "SELECT DISTINCT pe.id,pe.name FROM people pe JOIN faces f ON f.personId=pe.id WHERE f.photoId=?",
      )
      .all(row.id),
  };
}
app.get("/api/photos", (req, res) =>
  res.json(
    db
      .prepare(
        photoSelect +
          (req.role === "viewer" ? " WHERE p.trash=0" : "") +
          " ORDER BY p.date DESC,p.created DESC",
      )
      .all()
      .map(publicPhoto),
  ),
);
app.get("/api/events", (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT e.*,COUNT(p.id) photoCount,MAX(p.demo) demo FROM events e LEFT JOIN photos p ON p.eventId=e.id AND p.trash=0 GROUP BY e.id ORDER BY e.date DESC",
      )
      .all(),
  ),
);
function eventFields(body) {
  const { title, date, location = "", description = "" } = body;
  if (typeof title !== "string" || !title.trim() || title.length > 120)
    throw new Error("请输入活动名称（不超过 120 字）");
  archivePath(root(), date, title, ".jpg");
  return [
    title.trim(),
    date,
    String(location).slice(0, 200),
    String(description).slice(0, 2000),
  ];
}
app.post("/api/events", (req, res) => {
  const fields = eventFields(req.body);
  const id = randomUUID();
  db.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(id, ...fields);
  res.json({ id });
});
app.patch("/api/events/:id", (req, res) => {
  const fields = eventFields(req.body);
  if (!db.prepare("SELECT id FROM events WHERE id=?").get(req.params.id))
    return res.status(404).json({ error: "活动不存在" });
  db.prepare(
    "UPDATE events SET title=?,date=?,location=?,description=? WHERE id=?",
  ).run(...fields, req.params.id);
  res.json({ ok: true });
});
app.get("/api/status", async (req, res) => {
  let accessible = true;
  try {
    await fs.access(root());
  } catch {
    accessible = false;
  }
  const stats = db
    .prepare(
      "SELECT COUNT(*) count,COALESCE(SUM(size),0) bytes FROM photos WHERE demo=0 AND trash=0",
    )
    .get();
  res.json({
    root: req.role === "admin" ? root() : undefined,
    role: req.role,
    authentication: !!token,
    configured: !!process.env.PHOTO_ROOT || !!setting("photoRoot", ""),
    accessible,
    ...stats,
    mode: "同步目录",
    syncState: "网盘同步状态由 WestlakeDrive 客户端管理",
    faceModels: await fs
      .access(
        path.join(
          base,
          "public/models/face_recognition_model-weights_manifest.json",
        ),
      )
      .then(() => true)
      .catch(() => false),
  });
});
app.patch("/api/settings", async (req, res) => {
  const folder = req.body.root;
  if (process.env.PHOTO_ROOT)
    return res
      .status(400)
      .json({ error: "存储目录已由 PHOTO_ROOT 配置，请修改 .env 并重启" });
  if (
    typeof folder !== "string" ||
    !path.isAbsolute(folder) ||
    folder.length > 500
  )
    throw new Error("请输入本机绝对路径，例如 D:\\WestlakeDrive\\跑团照片");
  await fs.mkdir(folder, { recursive: true });
  await fs.access(folder, 2);
  setSetting("photoRoot", path.resolve(folder));
  res.json({ ok: true });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) =>
    cb(
      null,
      imageExtensions.has(path.extname(file.originalname).toLowerCase()),
    ),
});
async function indexPhoto(buffer, name, date, eventId, existingFile = null) {
  const hash = hashFile(buffer);
  const duplicate = db.prepare("SELECT id FROM photos WHERE hash=?").get(hash);
  if (duplicate) return { duplicate: true, id: duplicate.id };
  const metadata = await sharp(buffer, {
    limitInputPixels: 80000000,
  }).metadata();
  if (!["jpeg", "png", "webp"].includes(metadata.format))
    throw new Error("图片内容不是支持的格式");
  const event = eventId
    ? db.prepare("SELECT * FROM events WHERE id=?").get(eventId)
    : null;
  if (eventId && !event) throw new Error("活动不存在");
  let captured;
  try {
    captured = (await exifr.parse(buffer, ["DateTimeOriginal"]))
      ?.DateTimeOriginal;
  } catch {}
  const actualDate =
    date ||
    (captured instanceof Date
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(captured)
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()));
  const file =
    existingFile ||
    archivePath(
      root(),
      actualDate,
      event?.title || "自由跑",
      metadata.format === "jpeg" ? ".jpg" : "." + metadata.format,
    );
  const id = randomUUID();
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (!existingFile) await fs.writeFile(file, buffer, { flag: "wx" });
  try {
    await sharp(buffer)
      .rotate()
      .resize({
        width: 900,
        height: 900,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toFile(path.join(data, "thumbnails", id + ".jpg"));
    db.prepare(
      "INSERT INTO photos(id,name,date,eventId,file,hash,size,width,height,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      name,
      actualDate,
      eventId || null,
      file,
      hash,
      buffer.length,
      metadata.width,
      metadata.height,
      new Date().toISOString(),
    );
  } catch (error) {
    if (!existingFile) await fs.unlink(file).catch(() => {});
    await fs.unlink(path.join(data, "thumbnails", id + ".jpg")).catch(() => {});
    throw error;
  }
  return { id };
}
app.post("/api/photos", upload.array("photos", 10), async (req, res) => {
  if (!req.files?.length) throw new Error("请选择 JPG、PNG 或 WebP 照片");
  if (req.body.date) archivePath(root(), req.body.date, "check", ".jpg");
  const results = [];
  for (const file of req.files) {
    try {
      results.push({
        name: Buffer.from(file.originalname, "latin1").toString("utf8"),
        ...(await indexPhoto(
          file.buffer,
          Buffer.from(file.originalname, "latin1").toString("utf8"),
          req.body.date,
          req.body.eventId,
        )),
      });
    } catch (error) {
      results.push({ name: file.originalname, error: error.message });
    }
  }
  res.json({
    results,
    added: results.filter((r) => r.id && !r.duplicate).length,
    duplicates: results.filter((r) => r.duplicate).length,
  });
});
app.patch("/api/photos", async (req, res) => {
  const { ids, changes } = req.body;
  if (
    !Array.isArray(ids) ||
    ids.length > 500 ||
    !ids.every((id) => typeof id === "string") ||
    !changes ||
    typeof changes !== "object"
  )
    throw new Error("照片参数无效");
  for (const key of ["favorite", "trash"])
    if (key in changes && typeof changes[key] !== "boolean")
      throw new Error("照片状态必须是布尔值");
  const keys = Object.keys(changes);
  if (
    !keys.length ||
    keys.some(
      (k) => !["favorite", "trash", "date", "eventId", "tags"].includes(k),
    )
  )
    throw new Error("不支持的修改");
  if ("date" in changes) archivePath(root(), changes.date, "check", ".jpg");
  if (
    "eventId" in changes &&
    changes.eventId !== null &&
    !db.prepare("SELECT id FROM events WHERE id=?").get(changes.eventId)
  )
    throw new Error("活动不存在");
  if (
    "tags" in changes &&
    (!Array.isArray(changes.tags) ||
      changes.tags.length > 20 ||
      !changes.tags.every((t) => typeof t === "string" && t.length <= 40))
  )
    throw new Error("标签格式无效");
  const values = keys.map((k) =>
    k === "tags"
      ? JSON.stringify(changes[k])
      : ["favorite", "trash"].includes(k)
        ? changes[k]
          ? 1
          : 0
        : changes[k],
  );
  db.exec("BEGIN");
  try {
    for (const id of ids)
      db.prepare(
        `UPDATE photos SET ${keys.map((k) => k + "=?").join(",")} WHERE id=?`,
      ).run(...values, id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.json({ ok: true });
});
app.get("/api/photos/:id/:kind", async (req, res) => {
  const p = db.prepare("SELECT * FROM photos WHERE id=?").get(req.params.id);
  if (req.role === "viewer" && p?.trash)
    return res.status(404).json({ error: "照片不存在" });
  if (!p || !["file", "thumbnail", "download"].includes(req.params.kind))
    return res.status(404).json({ error: "照片不存在" });
  const file = p.demo
    ? path.join(base, "public", p.file)
    : req.params.kind === "thumbnail"
      ? path.join(data, "thumbnails", p.id + ".jpg")
      : p.file;
  try {
    await fs.access(file);
  } catch {
    return res
      .status(404)
      .json({ error: "原文件不在当前目录，请检查网盘同步" });
  }
  if (req.params.kind === "download") res.download(file, p.name);
  else res.sendFile(path.resolve(file));
});
let scanning = false;
app.post("/api/scan", async (req, res) => {
  if (scanning) return res.status(409).json({ error: "目录扫描正在进行" });
  scanning = true;
  let added = 0,
    duplicates = 0,
    errors = 0,
    visited = 0;
  const messages = [];
  async function visit(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      if (!within(root(), file)) continue;
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      if (!imageExtensions.has(path.extname(file).toLowerCase())) continue;
      if (++visited > 10000)
        throw new Error("单次最多扫描 10000 张，请分批整理目录");
      try {
        const stat = await fs.stat(file);
        if (stat.size > 25 * 1024 * 1024) throw new Error("超过 25 MB");
        const buffer = await fs.readFile(file);
        const match = file.match(/(\d{4}-\d{2}-\d{2})/);
        let eventId = null;
        const parent = path.basename(path.dirname(file));
        let date = match?.[1];
        if (date) {
          archivePath(root(), date, "check", ".jpg");
          const title =
            parent.replace(/^\d{4}-\d{2}-\d{2}[_ ]?/, "") || "自由跑";
          const existing = db
            .prepare("SELECT id FROM events WHERE title=? AND date=?")
            .get(title, date);
          eventId = existing?.id || randomUUID();
          if (!existing)
            db.prepare("INSERT INTO events(id,title,date) VALUES(?,?,?)").run(
              eventId,
              title,
              date,
            );
        }
        const r = await indexPhoto(buffer, entry.name, date, eventId, file);
        r.duplicate ? duplicates++ : added++;
      } catch (error) {
        errors++;
        if (messages.length < 5)
          messages.push(`${entry.name}: ${error.message}`);
      }
    }
  }
  try {
    await visit(root());
    res.json({ added, duplicates, errors, messages });
  } finally {
    scanning = false;
  }
});
app.get("/api/people", (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT pe.id,pe.name,pe.avatar,COUNT(DISTINCT p.id) photoCount FROM people pe LEFT JOIN faces f ON f.personId=pe.id LEFT JOIN photos p ON p.id=f.photoId AND p.trash=0 GROUP BY pe.id",
      )
      .all()
      .filter((p) => p.photoCount > 0)
      .map((p) => ({
        ...p,
        avatar: p.avatar ? `/api/people/${p.id}/avatar` : null,
      })),
  ),
);
app.get("/api/people/:id/avatar", (req, res) => {
  const row = db
    .prepare("SELECT avatar FROM people WHERE id=?")
    .get(req.params.id);
  if (!row?.avatar) return res.sendStatus(404);
  res.type("jpeg").send(Buffer.from(row.avatar.split(",")[1], "base64"));
});
app.patch("/api/people/:id", (req, res) => {
  const name = req.body.name;
  if (typeof name !== "string" || !name.trim() || name.length > 50)
    throw new Error("请输入成员名字（不超过 50 字）");
  db.prepare("UPDATE people SET name=? WHERE id=?").run(
    name.trim(),
    req.params.id,
  );
  res.json({ ok: true });
});
app.post("/api/people/merge", (req, res) => {
  const { from, to } = req.body;
  if (
    from === to ||
    !db.prepare("SELECT id FROM people WHERE id=?").get(from) ||
    !db.prepare("SELECT id FROM people WHERE id=?").get(to)
  )
    throw new Error("请选择两个不同分组");
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE faces SET personId=? WHERE personId=?").run(to, from);
    db.prepare("DELETE FROM people WHERE id=?").run(from);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.json({ ok: true });
});
app.post("/api/faces", (req, res) => {
  const { photoId, faces } = req.body;
  const p = db
    .prepare("SELECT id,analyzed,demo FROM photos WHERE id=?")
    .get(photoId);
  if (!p || p.demo) throw new Error("只能分析已导入的照片");
  if (p.analyzed) return res.json({ ok: true, alreadyAnalyzed: true });
  if (
    !Array.isArray(faces) ||
    faces.length > 80 ||
    faces.some(
      (f) =>
        !Array.isArray(f.descriptor) ||
        f.descriptor.length !== 128 ||
        !f.descriptor.every(
          (v) =>
            typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 10,
        ) ||
        !Array.isArray(f.box) ||
        f.box.length !== 4 ||
        !f.box.every((v) => Number.isFinite(v) && v >= 0) ||
        (f.avatar &&
          (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f.avatar) ||
            f.avatar.length > 80000)),
    )
  )
    throw new Error("人脸数据无效");
  db.exec("BEGIN");
  try {
    for (const face of faces) {
      const people = db.prepare("SELECT * FROM people").all();
      let best = null,
        distance = 0.48;
      for (const person of people) {
        const d = faceDistance(face.descriptor, JSON.parse(person.descriptor));
        if (d < distance) {
          distance = d;
          best = person;
        }
      }
      let personId = best?.id;
      if (!personId) {
        personId = randomUUID();
        db.prepare("INSERT INTO people VALUES(?,?,?,?)").run(
          personId,
          `待命名成员 ${people.length + 1}`,
          JSON.stringify(face.descriptor),
          face.avatar || null,
        );
      }
      db.prepare("INSERT INTO faces VALUES(?,?,?,?,?)").run(
        randomUUID(),
        photoId,
        personId,
        JSON.stringify(face.descriptor),
        JSON.stringify(face.box),
      );
    }
    db.prepare("UPDATE photos SET analyzed=1 WHERE id=?").run(photoId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.json({ ok: true, count: faces.length });
});
app.use(express.static(path.join(base, "public")));
app.use(express.static(path.join(base, "dist")));
app.get("/{*splat}", async (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "接口不存在" });
  res.sendFile(path.join(base, "dist/index.html"));
});
app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(error.status || 400).json({
    error:
      error.code === "LIMIT_FILE_SIZE"
        ? "每张照片最大 25 MB"
        : error.message || "操作失败",
  });
});
const host = process.env.HOST || "127.0.0.1";
if (host !== "127.0.0.1" && host !== "localhost" && !token)
  throw new Error("局域网访问需设置 ARCHIVE_TOKEN");
app.listen(Number(process.env.PORT) || 3001, host, () =>
  console.log(
    `拾光照片档案 http://${host}:${Number(process.env.PORT) || 3001}`,
  ),
);
