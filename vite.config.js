import { defineConfig } from "vite";
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
  // fetch a separate face-api chunk later in the middle of indexing.
  build: { chunkSizeWarningLimit: 1800, outDir: mode === "pages" ? "dist-pages" : "dist",
    ...(mode === "pages" ? { rollupOptions: { output: { inlineDynamicImports: true } } } : {}),
  },
}));
