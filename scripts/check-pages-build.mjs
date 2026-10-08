import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = new URL("../dist-pages/", import.meta.url);
const scripts = (await readdir(new URL("assets/", root))).filter(name => name.endsWith(".js"));
assert.equal(scripts.length, 1, "Pages must ship one JavaScript bundle, including the face engine");
const html = await readFile(new URL("index.html", root), "utf8");
assert.ok(html.includes(`./assets/${scripts[0]}`), "HTML must reference the bundled face engine entry");
const source = await readFile(new URL(`assets/${scripts[0]}`, root), "utf8");
assert.ok(!/\bimport\s*\(/.test(source), "Pages must not fetch dynamic JavaScript modules after page load");
console.log("Pages bundle verified: face engine included, no dynamic module requests.");
