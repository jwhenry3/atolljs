import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        // Tests need the client build — the server build resolved under Node
        // has intentionally non-reactive primitives (effects never run).
        'solid-js': fileURLToPath(new URL('./node_modules/solid-js/dist/solid.js', import.meta.url)),
      },
    },
  })
);
