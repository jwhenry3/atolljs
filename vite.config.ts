import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

const deps = Object.keys(pkg.dependencies);

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
    rollupOptions: {
      // Libraries don't bundle dependencies — consumers resolve zod/msgpackr/
      // solid-js/@msgpack from their own node_modules via "dependencies".
      external: (id) =>
        id.startsWith("node:") ||
        deps.some((d) => id === d || id.startsWith(`${d}/`)),
      output: {
        // One dist file per src module — consumers tree-shake unused SDK
        // surface (e.g. no mz → no zod in their bundle) instead of pulling a
        // single monolithic chunk.
        preserveModules: true,
        preserveModulesRoot: "src/sdk",
      },
    },
  },
});
