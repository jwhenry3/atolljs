import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { atoll } from '../../packages/vite/src/index.ts';

// Dev harness — mounts the island through the published contract so `vite
// dev` previews what a consumer sees. The contract's worker factory points
// at dist-mfe/counter.worker.js (package-relative), so run
// `npm run build:mfe` once before `vite dev`.
const pkg = (p: string): string =>
  fileURLToPath(new URL(p, import.meta.url)).replace(/\\/g, '/');
const coreRoot = pkg('../../src/');
const islandsRoot = pkg('../../packages/islands/src/');
const devtoolsRoot = pkg('../../packages/devtools/src/');
const reactIslandRoot = pkg('../../packages/react-island/src/');

export default defineConfig(({ command }) => ({
  // Relative base — the built output works at any mount depth.
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
      { find: /^@atolljs\/react-island$/, replacement: `${reactIslandRoot}index.tsx` },
      { find: /^@atolljs\/react-island\/worker$/, replacement: `${reactIslandRoot}worker.ts` },
    ],
  },
  plugins: [atoll()],
  server: {
    fs: { allow: ['../..'] },
    port: 5185,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
}));
