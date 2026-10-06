import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { atoll } from '../packages/vite/src/index.ts';

// The sdk and the island packages live in the workspace root — alias the
// package names to their sources so the page runs against them without a
// build step. The MFE contracts + worker entries resolve by relative
// import from ../examples/mfe/.
const pkg = (p: string): string =>
  fileURLToPath(new URL(p, import.meta.url)).replace(/\\/g, '/');
const coreRoot = pkg('../src/');
const islandsRoot = pkg('../packages/islands/src/');

export default defineConfig(({ command }) => ({
  // Relative base — the built output works at any mount depth (Pages root,
  // serve-all /, dev /).
  base: command === 'build' ? './' : '/',
  resolve: {
    // react-reconciler resolves `react` through its peer dep — force one copy.
    dedupe: ['react'],
    alias: [
      { find: /^@atolljs\/core$/, replacement: `${coreRoot}index.ts` },
      { find: /^@atolljs\/core\//, replacement: coreRoot },
      { find: /^@atolljs\/islands$/, replacement: `${islandsRoot}index.ts` },
      { find: /^@atolljs\/islands\/worker$/, replacement: `${islandsRoot}worker/index.ts` },
      { find: /^@atolljs\/react-island$/, replacement: `${pkg('../packages/react-island/src/')}index.tsx` },
      { find: /^@atolljs\/react-island\/worker$/, replacement: `${pkg('../packages/react-island/src/')}worker.ts` },
      { find: /^@atolljs\/vue-island$/, replacement: `${pkg('../packages/vue-island/src/')}index.ts` },
      { find: /^@atolljs\/vue-island\/worker$/, replacement: `${pkg('../packages/vue-island/src/')}worker.ts` },
      { find: /^@atolljs\/solid-island$/, replacement: `${pkg('../packages/solid-island/src/')}index.ts` },
      { find: /^@atolljs\/solid-island\/worker$/, replacement: `${pkg('../packages/solid-island/src/')}worker.ts` },
      { find: /^@atolljs\/svelte-island$/, replacement: `${pkg('../packages/svelte-island/src/')}index.ts` },
      { find: /^@atolljs\/svelte-island\/worker$/, replacement: `${pkg('../packages/svelte-island/src/')}worker.ts` },
      { find: /^@atolljs\/angular-island$/, replacement: `${pkg('../packages/angular-island/src/')}index.ts` },
      { find: /^@atolljs\/angular-island\/worker$/, replacement: `${pkg('../packages/angular-island/src/')}worker.ts` },
      // The Solid worker app compiles solid-js/universal, which does a bare
      // `import 'solid-js'` — under worker/node export conditions that
      // resolves to dist/server.js whose effects never run. EXACT match only.
      { find: /^solid-js$/, replacement: `${pkg('../node_modules/')}solid-js/dist/solid.js` },
    ],
  },
  // The MFE workers carry real .vue/.svelte SFCs — both plugins run inside
  // the worker build (worker.plugins needs FRESH instances). atoll()
  // dev-bundles worker entries so worker code never sees the browser
  // transform pipeline.
  plugins: [vue(), svelte(), atoll()],
  worker: {
    plugins: () => [vue(), svelte()],
  },
  server: {
    fs: { allow: ['..'] },
    port: 4175,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      // credentialless keeps crossOriginIsolated (SharedArrayBuffer
      // doorbell, push transport) while letting no-cors subresources load.
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
}));
