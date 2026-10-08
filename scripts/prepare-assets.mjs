import { promises as fs } from "node:fs";
import path from "node:path";
const demo = path.resolve("public/demo");
await fs.mkdir(demo, { recursive: true });
const ids = [
  "1552674605-db6ffd4facb5",
  "1476480862126-209bfaa8edc8",
  "1461896836934-ffe607ba8211",
  "1502904550040-7534597429ae",
  "1538805060514-97d9cc17730c",
  "1452626038306-9aae5e071dd3",
  "1476480862126-209bfaa8edc8",
  "1538805060514-97d9cc17730c",
  "1552674605-db6ffd4facb5",
  "1461896836934-ffe607ba8211",
  "1464822759023-fed622ff2c3b",
  "1452626038306-9aae5e071dd3",
  "1500534623283-312aade485b7",
  "1502904550040-7534597429ae",
  "1476480862126-209bfaa8edc8",
];
await Promise.all(
  ids.map(async (id, i) => {
    const target = path.join(demo, `${i + 1}.jpg`);
    try {
      await fs.access(target);
      return;
    } catch {}
    const url = `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1100&q=85${i > 5 ? "&crop=entropy" : ""}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`图片 ${i + 1}: ${r.status}`);
    await fs.writeFile(target, Buffer.from(await r.arrayBuffer()));
    console.log("示例图片", i + 1);
  }),
);
const models = path.resolve("public/models");
await fs.mkdir(models, { recursive: true });
const sources = [
  "tiny_face_detector_model",
  "face_landmark_68_tiny_model",
  "face_recognition_model",
];
for (const name of sources) {
  const manifestFile = `${name}-weights_manifest.json`;
  const url =
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/";
  const r = await fetch(url + manifestFile, {
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`模型下载失败: ${r.status}`);
  const manifest = await r.json();
  await fs.writeFile(path.join(models, manifestFile), JSON.stringify(manifest));
  await Promise.all(
    manifest
      .flatMap((group) => group.paths)
      .map(async (shard) => {
        const r = await fetch(url + shard, {
          signal: AbortSignal.timeout(60000),
        });
        if (!r.ok) throw new Error(`模型分片下载失败: ${r.status}`);
        await fs.writeFile(
          path.join(models, shard),
          Buffer.from(await r.arrayBuffer()),
        );
      }),
  );
  console.log("本地模型", name);
}
