import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The sdk lives in the workspace root — alias the package name to its source
// so the example runs against it without a build step.
const sdkRoot = fileURLToPath(new URL('../../src/sdk/', import.meta.url)).replace(/\\/g, '/');

export default defineConfig(({ command }) => ({
  // Built output is mounted at /react-dom-worker/ under the unified dist root; dev serves /.
  base: command === 'build' ? '/react-dom-worker/' : '/',
  resolve: {
    // react-reconciler resolves `react` through its peer dep — without dedupe
    // the worker could bundle two React copies and hooks would read a null
    // dispatcher. Force a single copy for the whole example.
    dedupe: ['react'],
    alias: [
      { find: /^@jwhenry123\/mesh$/, replacement: `${sdkRoot}index.ts` },
      { find: /^@jwhenry123\/mesh\/sdk$/, replacement: `${sdkRoot}index.ts` },
      { find: /^@jwhenry123\/mesh\/sdk\//, replacement: sdkRoot },
    ],
  },
  // The ops themselves still ride postMessage — but the push transport uses
  // a SharedArrayBuffer doorbell (see src/memory.ts), which requires
  // cross-origin isolation. Poll mode needs none of this — that's the
  // tradeoff the toolbar lets you feel.
  server: {
    fs: { allow: ['../..'] },
    port: 5177,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
}));
