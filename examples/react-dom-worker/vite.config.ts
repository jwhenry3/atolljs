import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// The sdk and the islands package live in the workspace root — alias the
// package names to their sources so the example runs against them without a
// build step. (The file: dependency in package.json would also resolve, but
// aliases make dev/test robust regardless of install state.)
const coreRoot = fileURLToPath(new URL('../../src/', import.meta.url)).replace(/\\/g, '/');
const islandsRoot = fileURLToPath(new URL('../../packages/islands/src/', import.meta.url)).replace(/\\/g, '/');
const vueIslandRoot = fileURLToPath(new URL('../../packages/vue-island/src/', import.meta.url)).replace(/\\/g, '/');
const solidIslandRoot = fileURLToPath(new URL('../../packages/solid-island/src/', import.meta.url)).replace(/\\/g, '/');
const svelteIslandRoot = fileURLToPath(new URL('../../packages/svelte-island/src/', import.meta.url)).replace(/\\/g, '/');
const angularIslandRoot = fileURLToPath(new URL('../../packages/angular-island/src/', import.meta.url)).replace(/\\/g, '/');

export default defineConfig(({ command }) => ({
  // Relative base — the built output works at any mount depth (serve-all /<name>/, Pages /consumer/<name>/); dev serves /.
  base: command === 'build' ? './' : '/',
  resolve: {
    // react-reconciler resolves `react` through its peer dep — without dedupe
    // the worker could bundle two React copies and hooks would read a null
    // dispatcher. Force a single copy for the whole example.
    dedupe: ['react'],
    alias: [
      { find: /^@atolljs\/core$/, replacement: `${coreRoot}index.ts` },
      { find: /^@atolljs\/core\//, replacement: coreRoot },
      { find: /^@atolljs\/islands$/, replacement: `${islandsRoot}index.ts` },
      { find: /^@atolljs\/islands\/worker$/, replacement: `${islandsRoot}worker/index.ts` },
      {
        find: /^@atolljs\/react-island$/,
        replacement: `${fileURLToPath(new URL('../../packages/react-island/src/', import.meta.url)).replace(/\\/g, '/')}index.tsx`,
      },
      {
        find: /^@atolljs\/react-island\/worker$/,
        replacement: `${fileURLToPath(new URL('../../packages/react-island/src/', import.meta.url)).replace(/\\/g, '/')}worker.ts`,
      },
      // The vue island's worker entry — aliases resolve the package to its
      // sources like islands above. `vue` itself comes from the root
      // install (the file: dep), one copy shared with nothing else here.
      { find: /^@atolljs\/vue-island$/, replacement: `${vueIslandRoot}index.ts` },
      { find: /^@atolljs\/vue-island\/worker$/, replacement: `${vueIslandRoot}worker.ts` },
      { find: /^@atolljs\/solid-island$/, replacement: `${solidIslandRoot}index.ts` },
      { find: /^@atolljs\/solid-island\/worker$/, replacement: `${solidIslandRoot}worker.ts` },
      { find: /^@atolljs\/svelte-island$/, replacement: `${svelteIslandRoot}index.ts` },
      { find: /^@atolljs\/svelte-island\/worker$/, replacement: `${svelteIslandRoot}worker.ts` },
      { find: /^@atolljs\/angular-island$/, replacement: `${angularIslandRoot}index.ts` },
      { find: /^@atolljs\/angular-island\/worker$/, replacement: `${angularIslandRoot}worker.ts` },
      // The Solid worker apps compile solid-js/universal, which does a bare
      // `import 'solid-js'` — under `worker`/`node` export conditions that
      // resolves to dist/server.js whose effects never run (the adapter
      // probes and throws). EXACT match only: a prefix alias would rewrite
      // deep specifiers like solid-js/html onto dist/solid.js/<subpath>.
      {
        find: /^solid-js$/,
        replacement: `${fileURLToPath(new URL('../../node_modules/', import.meta.url)).replace(/\\/g, '/')}solid-js/dist/solid.js`,
      },
    ],
  },
  // The Vue/Svelte shells are real SFCs — @vitejs/plugin-vue compiles
  // .vue files (worker/vue/*.vue too), vite-plugin-svelte compiles
  // .svelte files (and svelte-island's .svelte.ts rune module). Both only
  // process their own flavored ids, so the React/TSX entries are untouched.
  plugins: [vue(), svelte()],
  // Worker bundles build in their own rolldown pass — worker.plugins must
  // carry FRESH plugin instances so worker/vue.worker.ts and
  // worker/svelte.worker.ts can import .vue/.svelte components (the
  // frameworks' islands run INSIDE the workers).
  worker: {
    plugins: () => [vue(), svelte()],
  },
  // Entry pages: index.html is the framework-free shell (src/main.ts);
  // each <fw>-shell.html mounts the same islands through that framework's
  // @atolljs/<fw>-island shell surface.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'react-shell': fileURLToPath(new URL('./react-shell.html', import.meta.url)),
        'vue-shell': fileURLToPath(new URL('./vue-shell.html', import.meta.url)),
        'solid-shell': fileURLToPath(new URL('./solid-shell.html', import.meta.url)),
        'svelte-shell': fileURLToPath(new URL('./svelte-shell.html', import.meta.url)),
        'angular-shell': fileURLToPath(new URL('./angular-shell.html', import.meta.url)),
      },
    },
  },
  // The ops themselves still ride postMessage — but the push transport uses
  // a SharedArrayBuffer doorbell (see packages/islands memory.ts), which
  // requires cross-origin isolation. Poll mode needs none of this — that's
  // the tradeoff the toolbar lets you feel.
  server: {
    fs: { allow: ['../..'] },
    port: 5177,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      // credentialless, not require-corp: it still grants
      // crossOriginIsolated (SharedArrayBuffer doorbell works) but lets
      // no-cors cross-origin subresources load without CORP headers — the
      // map island's OSM tile <img>s come from tile.openstreetmap.org.
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
}));
