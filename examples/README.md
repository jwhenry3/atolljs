# Incidents demo — framework examples

The same incidents pattern ported to six frameworks. Each folder is an isolated
project with its own dependencies; every one consumes the `@atolljs/core` sdk
directly from source via an `@atolljs/core` → `../../src` alias (no build step
needed for the sdk).

Run all examples together from the repository root:

```sh
npm run dev:all    # dev servers (HMR) for every app + the consumer docs site
npm run serve:all  # builds everything, then serves the production output
```

`dev:all` launches each example on its own port (consumer docs on 4181);
Ctrl+C stops the complete process group. `serve:all` serves the built `dist/`
output on `http://localhost:4173` — the landing page links to every mount
(`/consumer/`, `/react/`, …) and Next.js runs via `next start` — pass
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

## Backend examples

The same incidents contract served as a JSON REST API — a `WorkerPool` of
`node:worker_threads` threads (`@atolljs/node`), no browser involved. Heavy
scans dispatch to pool workers; record reads hit shared memory directly on
the API thread.

| Example  | Dir                | Command         | Port |
|----------|--------------------|-----------------|------|
| NestJS   | `examples/nestjs`  | `npm run dev`   | 3100 |
| Express  | `examples/express` | `npm run dev`   | 3200 |
| Fastify  | `examples/fastify` | `npm run dev`   | 3201 |
| Hono     | `examples/hono`    | `npm run dev`   | 3202 |
| Koa      | `examples/koa`     | `npm run dev`   | 3203 |
| HTTP offload | `examples/http-offload` | `npm run dev` | 3204 |

The four non-Nest backends share one shape: `src/incidents.ts` wires
`createNodePool` + `workerClient<IncidentsWorker>`, `src/incidents.worker.ts`
is the worker entry (`@atolljs/node/shim` first), and `src/main.ts` is the
framework's thin HTTP adapter. Because `worker_threads` spawns plain Node
processes (tsx/loader hooks don't propagate), each example bundles its worker
entry with esbuild (`npm run bundle` → `dist/incidents.worker.js`) — `dev`,
`build`, and `start` run it automatically.

`http-offload` flips the demo further: Express runs inside the pool itself. A
gateway on :3204 pins `/api/a/*` to worker A, `/api/b/*` to worker B, and
serves the rest on the API thread (any Node), plus a clustered listener on
:3205 that hands accepted connections to workers unparsed (Node ≥ 26).

## SharedArrayBuffer requirements

Workers share memory through `SharedArrayBuffer`, which browsers only expose in
cross-origin-isolated contexts. Every example sets COOP/COEP headers on its dev
server (vite `server.headers`, Angular dev-server `headers`, Next `headers()`).

## Worker bundling

Bundlers only emit a worker chunk when the entry is written inline —
`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
Each example passes that through the pool's `createWorker` config so the worker
is detected by Vite, Angular's esbuild builder, and Next's webpack/turbopack.
