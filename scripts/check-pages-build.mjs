import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ARCFACE_SHA256, ARCFACE_BYTES, ARCFACE_CHUNK_BYTES } from "../src/fusion-utils.js";

const root = new URL("../dist-pages/", import.meta.url);
const scripts = (await readdir(new URL("assets/", root))).filter(name => name.endsWith(".js"));
assert.equal(scripts.length, 1, "Pages must ship one JavaScript bundle, including the face engine");
const html = await readFile(new URL("index.html", root), "utf8");
assert.ok(html.includes(`./assets/${scripts[0]}`), "HTML must reference the bundled face engine entry");
const source = await readFile(new URL(`assets/${scripts[0]}`, root), "utf8");
assert.ok(!/\bimport\s*\(\s*["'][^"']*assets\//.test(source), "Pages must not fetch separate hashed face-engine chunks");
const wasm = await readFile(new URL("runtime/ort-1.24.3/ort-wasm-simd-threaded.wasm",root));
assert.ok(wasm.length > 10000000, "The pinned WASM runtime must be published alongside the entry");
for (const [file,expected] of [
  ["face_detection_yunet_2026may.onnx","ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0"],
]) {
  const bytes=await readFile(new URL("models/sface-v1/"+file,root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),expected,"Published ONNX model must match the verified source");
}
const arcHash=createHash("sha256");let arcBytes=0;
for(let i=0;i<4;i++){
  const bytes=await readFile(new URL(`models/arcface-v1/w600k_r50.part${i}.bin`,root));
  assert.equal(bytes.length,Math.min(ARCFACE_CHUNK_BYTES,ARCFACE_BYTES-i*ARCFACE_CHUNK_BYTES));
  arcHash.update(bytes);arcBytes+=bytes.length;
}
assert.equal(arcBytes,ARCFACE_BYTES);assert.equal(arcHash.digest("hex"),ARCFACE_SHA256);
console.log("Pages bundle verified: one entry, pinned WASM, verified YuNet and ArcFace model shards.");
