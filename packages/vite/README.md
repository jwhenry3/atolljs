# @atolljs/vite

Vite dev-server plugin for [Atoll](https://jwhenry3.github.io/atolljs/) worker
entries (`new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`).

## What it does

In dev mode, Vite normally serves every module — including worker entries —
through the same transform pipeline as the browser app. That pipeline injects
browser-only code into worker modules: React fast-refresh (`/@react-refresh`
reads `window` unguarded), `/@vite/client` hot contexts, SFC HMR wrappers.
Inside a `DedicatedWorkerGlobalScope` those globals don't exist, so worker
islands crash at evaluation before Atoll's DOM shim can install.

Worker-side HMR can't help anyway: a worker's module graph can't be partially
reloaded, so the only meaningful update is **rebuild + respawn**. This plugin
implements exactly that:

1. `?worker_file` / `?sharedworker_file` requests are intercepted **before**
   vite's transform middleware and answered with a single esbuild bundle.
2. The bundle's full input graph (via esbuild's metafile) is watched; any
   change invalidates the cache and sends a `full-reload`, so the next page
   load spawns a fresh worker on fresh code.
3. Imports resolve through vite's `pluginContainer` (`resolveId`), so aliases
   and tsconfig paths behave identically to the app. Worker graphs containing
   framework SFCs (`.vue`/`.svelte`/`.astro`) fall back to vite's per-module
   serving — safe, since those plugins don't inject `window`-bound code at
   module scope.
4. Response headers echo `server.headers` — required so COOP/COEP
   (`require-corp`) pages don't block the worker script fetch.

`vite build` workers bundle through vite's normal pipeline. In a build the
plugin only copies the devtools dashboard into the output at `/__atoll/`,
and by default only when the app bundles `@atolljs/devtools`, so the
overlay flyout keeps working in production.

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import atoll from '@atolljs/vite';

export default defineConfig({
  plugins: [react(), atoll()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

### Options

```ts
atoll({
  // merged into the bundle's `define` after vite's config.define
  define: { 'import.meta.env.VITE_FLAG': '"on"' },
  // JSX handling for worker entries (default: automatic runtime)
  jsx: 'automatic',
  jsxImportSource: 'solid-js', // e.g. for solid worker islands
  // devtools dashboard at <outDir>/__atoll/ on `vite build`:
  // 'auto' (default) when the app bundles @atolljs/devtools, true always,
  // false never; `dir` renames the folder
  devtools: { build: 'auto', dir: '__atoll' },
});
```

## Limitations

- **Worker entries importing framework SFCs** (`.vue`/`.svelte`/`.astro`/
  `.md`/`.mdx`) aren't bundled — esbuild can't compile them and their vite
  plugin output references browser-only virtual modules. Those requests fall
  back to vite's per-module pipeline, which those plugins handle safely in
  workers.
- **Styles and assets inside worker entries resolve to empty modules.**
  Worker islands render through the proxy DOM — stylesheets belong on the
  main thread.
- **Nested workers inside a worker bundle** are not re-detected; keep worker
  construction on the main thread.
- Main-thread React fast-refresh is unaffected — this only changes how
  *worker entries* are served.

## Build

The package ships `dist/` (compiled) plus `src/` for transparency — a plugin
must be plain JS because Node refuses type-stripping under `node_modules`.

```bash
npm run build   # esbuild bundle + tsc declarations
```
