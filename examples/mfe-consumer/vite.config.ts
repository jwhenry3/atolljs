import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { atoll } from '../../packages/vite/src/index.ts';

// Consumer shell — imports the MFE contract BY PACKAGE NAME
// (`@atolljs/mfe-counter` → file:../mfe-publish, exports → the contract
// module) and never sees worker source. The contract's worker factory does
// `new URL('../../dist-mfe/counter.worker.js', import.meta.url)`, resolved
// through the package symlink to the producer's real dist-mfe/ — vite emits
// that file as an asset in this app's build, or serves it directly in dev.
//
// With VITE_MFE_ORIGIN=http://localhost:5186 the same contract instead
// fetches the worker from the producer's `vite preview` (see
// mfe-publish/vite.mfe.config.ts) — the remote/CDN shape.
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
      { find: /^@atolljs\/react-island$/, replacement: `${reactIslandRoot}index.tsx` },
    ],
  },
  plugins: [atoll()],
  server: {
    // The contract file lives in ../mfe-publish (through the package
    // symlink) — dist-mfe/ resolves under it.
    fs: { allow: ['../..'] },
    port: 5187,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
}));
