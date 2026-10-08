import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { archivePath, safeSegment, faceDistance, within } from "./archive.mjs";

test("归档路径不会被活动名称中的路径字符逃逸，非法日期被拒绝", () => {
  const root = path.resolve("tmp/test-originals");
  const file = archivePath(root, "2026-10-08", "../../秋日:环湖", ".JPG");
  assert.equal(within(root, file), true);
  assert.ok(file.endsWith(".jpg"));
  assert.throws(() => archivePath(root, "2026-02-30", "晨跑", ".jpg"));
  assert.throws(() => archivePath(root, "2026-10-08", "晨跑", ".svg"));
  assert.equal(safeSegment(""), "未命名活动");
});
test("人脸距离区分相同描述向量与不同向量", () => {
  assert.equal(faceDistance(Array(128).fill(0), Array(128).fill(0)), 0);
  assert.ok(faceDistance(Array(128).fill(0), Array(128).fill(0.1)) > 0.48);
  assert.equal(faceDistance([], []), Infinity);
});
test("照片 API：访问控制、上传、去重、标签、回收恢复、扫描、人脸合并和重启持久化", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stride-archive-test-"));
  const photoRoot = path.join(dir, "originals");
  const port = 3197;
  const base = `http://127.0.0.1:${port}`;
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: dir,
        PHOTO_ROOT: photoRoot,
        PORT: String(port),
        HOST: "127.0.0.1",
        ARCHIVE_TOKEN: "test-only-token",
        VIEWER_TOKEN: "test-viewer-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stderr.on("data", (b) => (output += b));
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(base + "/api/status");
        if (r.status === 401) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("测试服务未启动 " + output);
  };
  const stop = () =>
    new Promise((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      child.kill();
    });
  t.after(async () => {
    await stop();
    const resolved = path.resolve(dir);
    if (
      !path.basename(resolved).startsWith("stride-archive-test-") ||
      path.dirname(resolved) !== path.resolve(os.tmpdir())
    )
      throw new Error("测试目录校验失败");
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const request = async (url, method = "GET", body) => {
    const response = await fetch(base + "/api" + url, {
      method,
      headers: {
        Authorization: "Bearer test-only-token",
        ...(body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  await start();
  const viewerStatus = await fetch(base + "/api/status", {
    headers: { Authorization: "Bearer test-viewer-token" },
  });
  const viewer = await viewerStatus.json();
  assert.equal(viewer.role, "viewer");
  assert.equal(viewer.root, undefined);
  assert.equal(
    (
      await fetch(base + "/api/events", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-viewer-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "无权创建", date: "2026-10-08" }),
      })
    ).status,
    403,
  );
  assert.equal((await fetch(base + "/api/photos")).status, 401);
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "test-only-token" }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await fetch(base + "/api/photos", { headers: { Cookie: cookie } })).status,
    200,
  );
  assert.equal(
    (
      await request("/events", "POST", {
        title: "无效日期",
        date: "2026-02-30",
      })
    ).status,
    400,
  );
  const e = await request("/events", "POST", {
    title: "测试晨跑",
    date: "2026-10-08",
    location: "测试地点",
  });
  assert.equal(e.status, 200);
  const eventId = e.body.id;
  const buffer = await sharp({
    create: { width: 120, height: 90, channels: 3, background: "#90a34c" },
  })
    .jpeg()
    .toBuffer();
  const form = () => {
    const f = new FormData();
    f.append(
      "photos",
      new Blob([buffer], { type: "image/jpeg" }),
      "测试照片.jpg",
    );
    f.append("eventId", eventId);
    f.append("date", "2026-10-08");
    return f;
  };
  const uploaded = await request("/photos", "POST", form());
  assert.equal(uploaded.body.added, 1);
  const id = uploaded.body.results[0].id;
  assert.equal((await request("/photos", "POST", form())).body.duplicates, 1);
  let p = (await request("/photos")).body.find((p) => p.id === id);
  assert.equal(p.name, "测试照片.jpg");
  assert.equal(p.eventId, eventId);
  assert.equal(p.size, buffer.length);
  assert.equal(p.file, undefined);
  const thumb = await fetch(base + p.thumb, {
    headers: { Authorization: "Bearer test-only-token" },
  });
  assert.equal(thumb.status, 200);
  assert.match(thumb.headers.get("content-type"), /image\/jpeg/);
  const original = await fetch(base + p.url, {
    headers: { Authorization: "Bearer test-only-token" },
  });
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), buffer);
  assert.equal(
    (
      await request("/photos", "PATCH", {
        ids: [id],
        changes: { favorite: true, tags: ["合影", "晨跑"] },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/photos", "PATCH", { ids: [id], changes: { date: "" } }))
      .status,
    400,
  );
  assert.equal(
    (
      await request("/photos", "PATCH", {
        ids: [id],
        changes: { file: "C:/Windows/win.ini" },
      })
    ).status,
    400,
  );
  await request("/photos", "PATCH", { ids: [id], changes: { trash: true } });
  assert.equal(
    (
      await fetch(base + p.url, {
        headers: { Authorization: "Bearer test-viewer-token" },
      })
    ).status,
    404,
  );
  const viewerPhotos = await (
    await fetch(base + "/api/photos", {
      headers: { Authorization: "Bearer test-viewer-token" },
    })
  ).json();
  assert.equal(
    viewerPhotos.some((p) => p.id === id),
    false,
  );
  assert.equal(
    (await request("/photos")).body.find((p) => p.id === id).trash,
    true,
  );
  assert.equal(
    (
      await fetch(base + p.url, {
        headers: { Authorization: "Bearer test-only-token" },
      })
    ).status,
    200,
  );
  await request("/photos", "PATCH", { ids: [id], changes: { trash: false } });
  const scanFolder = path.join(photoRoot, "2026-10-07_环湖测试");
  await fs.mkdir(scanFolder, { recursive: true });
  const image2 = await sharp(buffer)
    .modulate({ brightness: 0.8 })
    .jpeg()
    .toBuffer();
  await fs.writeFile(path.join(scanFolder, "已有.jpg"), image2);
  const scan = await request("/scan", "POST", {});
  assert.equal(scan.body.added, 1);
  assert.equal(scan.body.duplicates, 1);
  assert.equal((await request("/scan", "POST", {})).body.added, 0);
  const p2 = (await request("/photos")).body.find(
    (p) => !p.demo && p.id !== id,
  );
  assert.equal(p2.date, "2026-10-07");
  assert.equal(p2.eventTitle, "环湖测试");
  const face = (v) => ({ descriptor: Array(128).fill(v), box: [0, 0, 20, 20] });
  assert.equal(
    (
      await request("/faces", "POST", {
        photoId: id,
        faces: [face(0), face(0.1)],
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/faces", "POST", { photoId: p2.id, faces: [face(0.01)] }))
      .status,
    200,
  );
  let people = (await request("/people")).body;
  assert.equal(people.length, 2);
  const group = people.find((p) => p.photoCount === 2);
  assert.ok(group);
  await request("/people/" + group.id, "PATCH", { name: "测试跑友" });
  await request("/people/merge", "POST", {
    from: people.find((p) => p.id !== group.id).id,
    to: group.id,
  });
  assert.equal((await request("/people")).body.length, 1);
  assert.equal(
    (await request("/faces", "POST", { photoId: id, faces: [] })).body
      .alreadyAnalyzed,
    true,
  );
  await stop();
  await start();
  p = (await request("/photos")).body.find((p) => p.id === id);
  assert.equal(p.favorite, true);
  assert.deepEqual(p.tags, ["合影", "晨跑"]);
  assert.equal(p.people[0].name, "测试跑友");
});
