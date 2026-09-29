# Incidents demo — framework examples

The same incidents pattern ported to six frameworks. Each folder is an isolated
project with its own dependencies; every one consumes the `@atolljs/core/sdk` sdk
directly from source via an `@atolljs/core/sdk` → `../../src/sdk` alias (no build step
needed for the sdk).

Run the root dashboard and all six examples together from the repository root:

```sh
npm run dev:all    # dev servers (HMR) for every app
npm run serve:all  # builds everything, then serves the production output
```

Both open `http://localhost:4173` and use the framework cards to navigate
between apps; Ctrl+C stops the complete process group. `serve:all` serves the
built `dist/` output on the same ports (Next.js via `next start`) — pass
`--no-build` to skip rebuilding.

The consumer docs site (`docs-consumer/`, port 4181) is launched alongside —
installation, API reference, and per-framework binding pages with embedded real
source. The internals guides live in-repo as markdown under `../docs/`.

The framework-neutral implementation lives in `../packages/incidents`: shared
memory and task contracts, worker implementation, pool singleton, task runners,
formatting, and table metadata. Generic sdk bindings live beside it in
`@atolljs/react`, `@atolljs/vue`, `@atolljs/solidjs`,
`@atolljs/svelte`, `@atolljs/angular`, and `@atolljs/nextjs` — they
adapt `observe()`/`defineTask()` to each framework's reactivity and carry no
incident knowledge. Each example owns the composition: a small local data layer
wires the incident tasks and shared fields through the framework bindings.

| Example  | Dir                | Command         | Port |
|----------|--------------------|-----------------|------|
| React    | `examples/react`   | `npm run dev`   | 5173 |
| Vue      | `examples/vue`     | `npm run dev`   | 5174 |
| Solid    | `examples/solid`   | `npm run dev`   | 5175 |
| Svelte   | `examples/svelte`  | `npm run dev`   | 5176 |
| Angular  | `examples/angular` | `npm run dev`   | 4201 |
| Next.js  | `examples/nextjs`  | `npm run dev`   | 3001 |

## SharedArrayBuffer requirements

Workers share memory through `SharedArrayBuffer`, which browsers only expose in
cross-origin-isolated contexts. Every example sets COOP/COEP headers on its dev
server (vite `server.headers`, Angular dev-server `headers`, Next `headers()`).

## Worker bundling

Bundlers only emit a worker chunk when the entry is written inline —
`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
Each example passes that through the pool's `createWorker` config so the worker
is detected by Vite, Angular's esbuild builder, and Next's webpack/turbopack.
