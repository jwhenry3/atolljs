import { readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

const deps = Object.keys(pkg.dependencies);

// Every non-test src module is a lib entry — the published "./*" export maps
// to ./dist/*.js, so deep imports (@atolljs/core/testing/inProcessWorker,
// worker/workerBootstrap) need emitted files even when index.ts doesn't
// reach them. preserveModules only writes what an entry can reach.
const srcEntries = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? srcEntries(join(dir, e.name))
      : e.name.endsWith(".ts") &&
          !e.name.endsWith(".test.ts") &&
          !e.name.endsWith(".d.ts")
        ? [join(dir, e.name)]
        : [],
  );

export default defineConfig({
  build: {
    lib: {
      entry: srcEntries("src"),
      formats: ["es"],
    },
    // 'hidden' writes .map files for local debugging but drops the
    // sourceMappingURL comment — the package excludes *.map, so a visible
    // map comment would leave consumers resolving a file that doesn't ship.
    sourcemap: "hidden",
    rollupOptions: {
      // Libraries don't bundle dependencies — consumers resolve msgpackr/
      // solid-js from their own node_modules via "dependencies".
      external: (id) =>
        id.startsWith("node:") ||
        deps.some((d) => id === d || id.startsWith(`${d}/`)),
      output: {
        // One dist file per src module — consumers tree-shake unused SDK
        // surface (e.g. no shared-memory fields → no reef schema code in
        // their bundle) instead of pulling a single monolithic chunk.
        // [name] carries the preserveModulesRoot-relative path, so emitted
        // files mirror src/ — that mirror is what "./*" → "./dist/*.js"
        // resolves against at stage time.
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
      },
    },
  },
});
