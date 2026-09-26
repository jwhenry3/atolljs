import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// The sdk lives in the workspace root — alias the package name to its source
// so the example runs against it without a build step.
const sdkRoot = fileURLToPath(new URL('../../src/sdk/', import.meta.url)).replace(/\\/g, '/');
const incidentsRoot = fileURLToPath(new URL('../../packages/incidents/src/', import.meta.url)).replace(/\\/g, '/');
const svelteBindingsRoot = fileURLToPath(new URL('../../packages/svelte/src/', import.meta.url)).replace(/\\/g, '/');

export default defineConfig(({ command }) => ({
  // Built output is mounted at /svelte/ under the unified dist root; dev serves /.
  base: command === 'build' ? '/svelte/' : '/',
  plugins: [svelte()],
  resolve: {
    alias: [
      { find: '@jwhenry123/mesh/svelte', replacement: `${svelteBindingsRoot}index.ts` },
      { find: '@jwhenry123/mesh/incidents', replacement: `${incidentsRoot}index.ts` },
      { find: /^@jwhenry123\/mesh$/, replacement: `${sdkRoot}index.ts` },
      { find: /^@jwhenry123\/mesh\/sdk$/, replacement: `${sdkRoot}index.ts` },
      { find: /^@jwhenry123\/mesh\/sdk\//, replacement: sdkRoot },
    ],
  },
  // SharedArrayBuffer requires a cross-origin isolated context
  server: {
    fs: { allow: ['../..'] },
    port: 5176,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy': "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*",
      'Cache-Control': 'no-store',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-site',
    },
  },
}));
