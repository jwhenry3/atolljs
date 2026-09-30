import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

const r = (p: string) => fileURLToPath(new URL(`./${p}`, import.meta.url));

export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [
      // Compiles `*.svelte.ts` rune modules (the svelte binding + example
      // data layer) so tests exercise the real reactive primitives. Vitest's
      // node environment reports consumer='server', which makes the plugin
      // compile runes as SSR stubs (effects never run) — force client output.
      svelte({
        dynamicCompileOptions: () => ({ generate: 'client' }),
      }),
    ],
    resolve: {
      alias: [
        // Tests exercise the package sources directly, not dist builds.
        { find: /^@atolljs\/core$/, replacement: r('src/index.ts') },
        { find: /^@atolljs\/core\/(.*)$/, replacement: r('src') + '/$1' },
        { find: /^@atolljs\/node$/, replacement: r('packages/node/src/index.ts') },
        { find: /^@atolljs\/node\/(.*)$/, replacement: r('packages/node/src') + '/$1' },
        { find: /^@atolljs\/nestjs$/, replacement: r('packages/nestjs/src/index.ts') },
        { find: /^@atolljs\/nestjs\/(.*)$/, replacement: r('packages/nestjs/src') + '/$1' },
        { find: /^@atolljs\/incidents$/, replacement: r('packages/incidents/src/index.ts') },
        { find: /^@atolljs\/incidents\/(.*)$/, replacement: r('packages/incidents/src') + '/$1' },
        { find: /^@atolljs\/islands$/, replacement: r('packages/islands/src/index.ts') },
        { find: /^@atolljs\/islands\/(.*)$/, replacement: r('packages/islands/src') + '/$1' },
        { find: /^@atolljs\/react-island$/, replacement: r('packages/react-island/src/index.tsx') },
        { find: /^@atolljs\/react-island\/(.*)$/, replacement: r('packages/react-island/src') + '/$1' },
        // The framework island packages — tests and example worker entries
        // import the published specifiers (incl. the ./worker subpath) and
        // land on sources, same as islands above.
        { find: /^@atolljs\/vue-island$/, replacement: r('packages/vue-island/src/index.ts') },
        { find: /^@atolljs\/vue-island\/(.*)$/, replacement: r('packages/vue-island/src') + '/$1' },
        { find: /^@atolljs\/svelte-island$/, replacement: r('packages/svelte-island/src/index.ts') },
        { find: /^@atolljs\/svelte-island\/(.*)$/, replacement: r('packages/svelte-island/src') + '/$1' },
        { find: /^@atolljs\/solid-island$/, replacement: r('packages/solid-island/src/index.ts') },
        { find: /^@atolljs\/solid-island\/(.*)$/, replacement: r('packages/solid-island/src') + '/$1' },
        { find: /^@atolljs\/angular-island$/, replacement: r('packages/angular-island/src/index.ts') },
        { find: /^@atolljs\/angular-island\/(.*)$/, replacement: r('packages/angular-island/src') + '/$1' },
        {
          find: /^@atolljs\/(react|vue|solidjs|svelte|angular|nextjs)$/,
          replacement: r('packages') + '/$1/src/index.ts',
        },
        // Tests need the client build — the server build resolved under Node
        // has intentionally non-reactive primitives (effects never run).
        // EXACT match only: deep specifiers (solid-js/universal, solid-js/store,
        // solid-js/web) must resolve through the package's own exports map —
        // a bare-string alias is a prefix match and would rewrite them onto
        // the nonexistent `dist/solid.js/<subpath>`.
        { find: /^solid-js$/, replacement: r('node_modules/solid-js/dist/solid.js') },
        { find: /^svelte$/, replacement: r('node_modules/svelte/src/index-client.js') },
        // Examples carry their own framework installs; pin every test to the
        // root copy so a component and its binding share one reactive runtime
        // (otherwise react's dispatcher / angular's injection context split).
        { find: /^react$/, replacement: r('node_modules/react') },
        { find: /^react\/(.*)$/, replacement: r('node_modules/react') + '/$1' },
        { find: /^react-dom(\/.*)?$/, replacement: r('node_modules/react-dom') + '$1' },
        { find: /^vue(\/.*)?$/, replacement: r('node_modules/vue') + '$1' },
        // Deep-import aliases must hit concrete files — rewriting to a path
        // bypasses the package's exports map.
        { find: /^@angular\/core\/testing$/, replacement: r('node_modules/@angular/core/fesm2022/testing.mjs') },
        {
          find: /^@angular\/platform-browser-dynamic\/testing$/,
          replacement: r('node_modules/@angular/platform-browser-dynamic/fesm2022/testing.mjs'),
        },
        { find: /^@angular\/(.*)$/, replacement: r('node_modules/@angular') + '/$1' },
      ],
    },
    test: {
      server: {
        deps: {
          // `solid-js/universal` (and any deep import) must be INLINED so its
          // internal `import 'solid-js'` flows through the alias above to the
          // client build — an externalized copy resolves 'solid-js' via Node's
          // exports map to the non-reactive server build (mounts, never
          // updates). Inlining all of solid-js also keeps ONE module instance
          // for every importer, inlined or not.
          inline: [/solid-js/],
        },
      },
      // Browser examples run their seed/scan pipeline in-process — larger
      // buffers and e2e app builds need headroom beyond the 5s default.
      testTimeout: 30_000,
      hookTimeout: 120_000,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        // The publishable surface: core sdk + every atoll-* binding package.
        include: ['src/**', 'packages/*/src/**'],
        exclude: ['**/*.test.*', '**/test/**', '**/testing/**'],
        // Floor slightly below the current ~96/88 baseline — regresses fail CI.
        thresholds: { statements: 95, branches: 85, functions: 93, lines: 96 },
      },
    },
  })
);
