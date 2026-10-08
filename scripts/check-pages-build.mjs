import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

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
  ["face_recognition_sface_2021dec.onnx","0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"],
]) {
  const bytes=await readFile(new URL("models/sface-v1/"+file,root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),expected,"Published ONNX model must match the verified source");
}
console.log("Pages bundle verified: one entry, embedded face runtime, pinned WASM and verified YuNet/SFace models.");
