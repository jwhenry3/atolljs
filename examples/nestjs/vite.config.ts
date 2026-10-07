import { globSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The sdk lives in the workspace root — alias the package names to sources
// so the example runs against them without a build step.
const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url)).replace(/\\/g, '/');
const coreRoot = pkg('../../src/');
const incidentsRoot = pkg('../../packages/incidents/src/');
const devtoolsRoot = pkg('../../packages/devtools/src/');
const nestjsRoot = pkg('../../packages/nestjs/src/');
const nodeRoot = pkg('../../packages/node/src/');

// Every *.worker.ts under src/ is its own entry — the pool config's
// `new URL('./x.worker.js', import.meta.url)` literal resolves against
// dist/main.js to the emitted file. Keys are basenames, so output is flat.
const workerInputs = Object.fromEntries(
  globSync('src/**/*.worker.ts').map((f) => [basename(f, '.ts'), f]),
);

export default defineConfig({
  build: {
    // Node SSR build: node builtins + node_modules stay external, the
    // aliased @atolljs/* sources bundle in.
    ssr: true,
    outDir: 'dist',
    rollupOptions: {
      input: { main: 'src/main.ts', ...workerInputs },
      // Flat layout: a `./x.worker.js` literal resolves to dist/<name>.worker.js
      // whether it lands in main.js or a shared chunk (the default assets/
      // subdir would put chunks one level too deep).
      output: { entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
    },
  },
  resolve: {
    alias: [
      { find: /^@atolljs\/nestjs$/, replacement: `${nestjsRoot}index.ts` },
      { find: /^@atolljs\/nestjs\//, replacement: nestjsRoot },
      { find: /^@atolljs\/incidents$/, replacement: `${incidentsRoot}index.ts` },
      { find: /^@atolljs\/incidents\//, replacement: incidentsRoot },
      { find: /^@atolljs\/devtools$/, replacement: `${devtoolsRoot}index.ts` },
      { find: /^@atolljs\/devtools\//, replacement: devtoolsRoot },
      { find: /^@atolljs\/node$/, replacement: `${nodeRoot}index.ts` },
      { find: /^@atolljs\/node\//, replacement: nodeRoot },
      { find: /^@atolljs\/core$/, replacement: `${coreRoot}index.ts` },
      { find: /^@atolljs\/core\//, replacement: coreRoot },
    ],
  },
});
