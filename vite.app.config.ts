import { defineConfig } from "vite";

// Dashboard app build — emits dist/index.html + assets alongside the sdk
// library bundle (vite build / vite.config.ts emits dist/index.js first).
export default defineConfig({
  // Fresh stamp per build — framework links append it as ?v=<stamp> so a
  // stale index.html document is never reused from cache.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  build: {
    outDir: "dist",
    emptyOutDir: false,
  },
});
