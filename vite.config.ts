import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

const deps = Object.keys(pkg.dependencies);

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
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
        preserveModulesRoot: "src",
      },
    },
  },
});
