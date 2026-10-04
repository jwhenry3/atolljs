import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { atoll } from '../../packages/vite/src/index.ts';

const pkg = (p: string): string =>
  fileURLToPath(new URL(p, import.meta.url)).replace(/\\/g, '/');
const coreRoot = pkg('../../src/');
const islandsRoot = pkg('../../packages/islands/src/');
const devtoolsRoot = pkg('../../packages/devtools/src/');

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  resolve: {
    dedupe: ['react'],
    alias: [
      { find: /^@atolljs\/devtools$/, replacement: `${devtoolsRoot}index.ts` },
      { find: /^@atolljs\/devtools\//, replacement: devtoolsRoot },
      { find: /^@atolljs\/core$/, replacement: `${coreRoot}index.ts` },
      { find: /^@atolljs\/core\//, replacement: coreRoot },
      { find: /^@atolljs\/islands$/, replacement: `${islandsRoot}index.ts` },
      { find: /^@atolljs\/islands\/worker$/, replacement: `${islandsRoot}worker/index.ts` },
      { find: /^@atolljs\/react-island$/, replacement: `${pkg('../../packages/react-island/src/')}index.tsx` },
      { find: /^@atolljs\/react-island\/worker$/, replacement: `${pkg('../../packages/react-island/src/')}worker.ts` },
      { find: /^@atolljs\/vue-island$/, replacement: `${pkg('../../packages/vue-island/src/')}index.ts` },
      { find: /^@atolljs\/vue-island\/worker$/, replacement: `${pkg('../../packages/vue-island/src/')}worker.ts` },
      { find: /^@atolljs\/solid-island$/, replacement: `${pkg('../../packages/solid-island/src/')}index.ts` },
      { find: /^@atolljs\/solid-island\/worker$/, replacement: `${pkg('../../packages/solid-island/src/')}worker.ts` },
      { find: /^@atolljs\/svelte-island$/, replacement: `${pkg('../../packages/svelte-island/src/')}index.ts` },
      { find: /^@atolljs\/svelte-island\/worker$/, replacement: `${pkg('../../packages/svelte-island/src/')}worker.ts` },
      { find: /^@atolljs\/angular-island$/, replacement: `${pkg('../../packages/angular-island/src/')}index.ts` },
      { find: /^@atolljs\/angular-island\/worker$/, replacement: `${pkg('../../packages/angular-island/src/')}worker.ts` },
      { find: /^solid-js$/, replacement: `${pkg('../../node_modules/')}solid-js/dist/solid.js` },
    ],
  },
  plugins: [vue(), svelte(), atoll()],
  worker: {
    plugins: () => [vue(), svelte()],
  },
  server: {
    fs: { allow: ['../..'] },
    port: 5184,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
}));
