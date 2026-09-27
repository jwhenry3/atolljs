import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The sdk lives in the workspace root — alias the package name to its source
// so the example runs against it without a build step.
const sdkRoot = fileURLToPath(new URL('../../src/sdk/', import.meta.url)).replace(/\\/g, '/');
const incidentsRoot = fileURLToPath(new URL('../../packages/incidents/src/', import.meta.url)).replace(/\\/g, '/');
const reactBindingsRoot = fileURLToPath(new URL('../../packages/react/src/', import.meta.url)).replace(/\\/g, '/');

export default defineConfig(({ command }) => ({
  // Built output is mounted at /react/ under the unified dist root; dev serves /.
  base: command === 'build' ? '/react/' : '/',
  plugins: [react()],
  resolve: {
    // The aliased @jwhenry123/mesh-react source resolves `react` from the
    // workspace root otherwise — two React copies get bundled and the
    // binding's hooks read a null dispatcher. Force a single copy.
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@jwhenry123/mesh-react', replacement: `${reactBindingsRoot}index.ts` },
      { find: '@jwhenry123/mesh-incidents', replacement: `${incidentsRoot}index.ts` },
      { find: /^@jwhenry123\/mesh$/, replacement: `${sdkRoot}index.ts` },
      { find: /^@jwhenry123\/mesh\/sdk$/, replacement: `${sdkRoot}index.ts` },
      { find: /^@jwhenry123\/mesh\/sdk\//, replacement: sdkRoot },
    ],
  },
  // SharedArrayBuffer requires a cross-origin isolated context
  server: {
    fs: { allow: ['../..'] },
    port: 5173,
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
