import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// MFE PUBLISH BUILD — separate from the dev-harness vite.config.ts so
// `vite build --config vite.mfe.config.ts` produces exactly ONE artifact:
// dist-mfe/counter.worker.js, a self-contained worker bundle (React runtime
// + islands worker side baked in).
//
// Deliberately a single-entry `build.lib`, not a two-entry contract+worker
// build: the worker entry imports the contract module, and multi-entry
// library builds code-split that shared module into a separate chunk the
// worker would have to fetch at runtime — an extra file to deploy and an
// extra CORS requirement. The contract ships to consumers as SOURCE via the
// package.json `exports` map instead; only the worker is a built artifact.
const pkg = (p: string): string =>
  fileURLToPath(new URL(p, import.meta.url)).replace(/\\/g, '/');
const coreRoot = pkg('../../src/');
const islandsRoot = pkg('../../packages/islands/src/');
const reactIslandRoot = pkg('../../packages/react-island/src/');

export default defineConfig({
  plugins: [
    {
      // The worker entry imports the contract, so the contract's
      // `bundledWorkerUrl` gets bundled too — and the asset plugin resolves
      // `new URL('../../dist-mfe/counter.worker.js', ...)` to the PREVIOUS
      // build's output, inlining it as a data URI inside its own successor
      // (the bundle grows ~the previous size every rebuild). The field is
      // dead code here — a worker never spawns itself — so stub the URL.
      name: 'mfe:stub-worker-url',
      // Pre — must rewrite the URL before vite's new URL asset plugin
      // resolves it.
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('counter.contract.ts')) return null;
        return code.replace(
          /new URL\(\s*'[^']*dist-mfe\/counter\.worker\.js'\s*,\s*import\.meta\.url,?\s*\)/,
          "'about:blank'",
        );
      },
    },
  ],
  // App builds define process.env.NODE_ENV automatically; a lib-mode worker
  // bundle doesn't, and React's dev/prod switch crashes with bare `process`
  // in a browser worker.
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  resolve: {
    dedupe: ['react'],
    alias: [
      { find: /^@atolljs\/core$/, replacement: `${coreRoot}index.ts` },
      { find: /^@atolljs\/core\//, replacement: coreRoot },
      { find: /^@atolljs\/islands$/, replacement: `${islandsRoot}index.ts` },
      { find: /^@atolljs\/islands\/worker$/, replacement: `${islandsRoot}worker/index.ts` },
      { find: /^@atolljs\/react-island$/, replacement: `${reactIslandRoot}index.tsx` },
      { find: /^@atolljs\/react-island\/worker$/, replacement: `${reactIslandRoot}worker.ts` },
    ],
  },
  build: {
    outDir: 'dist-mfe',
    emptyOutDir: true,
    minify: true,
    lib: {
      entry: 'src/mfe/counter.worker.tsx',
      formats: ['es'],
      fileName: () => 'counter.worker.js',
    },
  },
  // `vite preview --config vite.mfe.config.ts` serves dist-mfe/ as a remote
  // origin — the Access-Control-Allow-Origin header is what makes it a
  // working stand-in for a CDN (module workers fetch through CORS).
  preview: {
    port: 5186,
    strictPort: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
});
