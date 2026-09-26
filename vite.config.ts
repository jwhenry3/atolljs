import { defineConfig } from "vite";

export default defineConfig({
  // Build-stamp for cache-busted links (fixed per dev-server boot).
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  // SharedArrayBuffer requires a cross-origin isolated context
  server: {
    port: 4173,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    lib: {
      entry: "src/sdk/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    sourcemap: true,
  },
});
