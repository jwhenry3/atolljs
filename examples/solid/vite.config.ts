import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// The sdk lives in the workspace root — alias the package name to its source
// so the example runs against it without a build step.
const sdkRoot = fileURLToPath(new URL('../../src/sdk/', import.meta.url)).replace(/\\/g, '/');
const incidentsRoot = fileURLToPath(new URL('../../packages/incidents/src/', import.meta.url)).replace(/\\/g, '/');
const solidBindingsRoot = fileURLToPath(new URL('../../packages/solidjs/src/', import.meta.url)).replace(/\\/g, '/');

export default defineConfig(({ command }) => ({
  // Built output is mounted at /solid/ under the unified dist root; dev serves /.
  base: command === 'build' ? './' : '/',
  plugins: [solid()],
  resolve: {
    // The aliased @atolljs/solidjs source resolves `solid-js` from the
    // workspace root otherwise — two reactive runtimes get bundled, and
    // binding signals never register in the app's render effects (UI frozen
    // at initial values). Force a single copy.
    dedupe: ['solid-js'],
    alias: [
      { find: '@atolljs/solidjs', replacement: `${solidBindingsRoot}index.ts` },
      { find: '@atolljs/incidents', replacement: `${incidentsRoot}index.ts` },
      { find: /^@atolljs\/core$/, replacement: `${sdkRoot}index.ts` },
      { find: /^@atolljs\/core\/sdk$/, replacement: `${sdkRoot}index.ts` },
      { find: /^@atolljs\/core\/sdk\//, replacement: sdkRoot },
    ],
  },
  // SharedArrayBuffer requires a cross-origin isolated context
  server: {
    fs: { allow: ['../..'] },
    port: 5175,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-site',
      'Content-Security-Policy': "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*",
      'Cache-Control': 'no-store',
    },
  },
}));
