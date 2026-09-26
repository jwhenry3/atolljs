import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Relative base — the built site works at / (standalone) and under a
  // mounted path in the unified dist root (serve:all); dev serves /.
  base: command === 'build' ? './' : '/',
  // Fresh stamp per build — demo links append it as ?v=<stamp> so a stale
  // index.html document is never reused from cache.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  plugins: [react()],
  // COOP/COEP so iframed demos can enter cross-origin isolation and use
  // SharedArrayBuffer inside the frame.
  server: {
    port: 4181,
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
