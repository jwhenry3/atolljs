import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// The sdk lives in the workspace root — alias the package name to its source
// so the example runs against it without a build step.
const sdkRoot = fileURLToPath(new URL('../../src/sdk/', import.meta.url)).replace(/\\/g, '/');
const incidentsRoot = fileURLToPath(new URL('../../packages/incidents/src/', import.meta.url)).replace(/\\/g, '/');
const vueBindingsRoot = fileURLToPath(new URL('../../packages/vue/src/', import.meta.url)).replace(/\\/g, '/');

export default defineConfig(({ command }) => ({
  // Built output is mounted at /vue/ under the unified dist root; dev serves /.
  base: command === 'build' ? './' : '/',
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@atolljs/vue', replacement: `${vueBindingsRoot}index.ts` },
      { find: '@atolljs/incidents', replacement: `${incidentsRoot}index.ts` },
      { find: /^@atolljs\/core$/, replacement: `${sdkRoot}index.ts` },
      { find: /^@atolljs\/core\/sdk$/, replacement: `${sdkRoot}index.ts` },
      { find: /^@atolljs\/core\/sdk\//, replacement: sdkRoot },
    ],
  },
  // SharedArrayBuffer requires a cross-origin isolated context
  server: {
    fs: { allow: ['../..'] },
    port: 5174,
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
