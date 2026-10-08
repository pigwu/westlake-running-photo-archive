import { defineConfig } from "vite";
import { mkdirSync, copyFileSync } from "node:fs";
// Keep runtime binaries versioned and on our own origin, rather than a CDN.
// Generated from the exact npm lockfile for both local dev and Pages builds.
mkdirSync("public/runtime/ort-1.24.3", { recursive:true });
copyFileSync("node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "public/runtime/ort-1.24.3/ort-wasm-simd-threaded.wasm");
copyFileSync("public/models/sface-v1/ONNXRUNTIME-LICENSE.txt", "public/runtime/ort-1.24.3/LICENSE.txt");
export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "./" : "/",
  plugins: mode === "pages" ? [{
    name: "shared-albums-entry",
    transformIndexHtml: { order: "pre", handler: html => html.replace('/src/main.jsx', '/src/shared-main.jsx') },
  }] : [],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  // Pages replaces the deployed asset directory on every release. Keep the
  // analysis code in the entry bundle so an open/cached page never has to
  // fetch a separate face-engine chunk later in the middle of indexing.
  build: { chunkSizeWarningLimit: 1800, outDir: mode === "pages" ? "dist-pages" : "dist",
    ...(mode === "pages" ? { rollupOptions: { output: { inlineDynamicImports: true } } } : {}),
  },
}));
