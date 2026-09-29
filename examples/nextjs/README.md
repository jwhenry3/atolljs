# Telecom Incident Explorer — Next.js

The incidents demo on the `@atolljs/core` sdk: 1M fixed-layout records seeded into
shared memory by a worker pool; the main thread publishes queries, the worker
scans/sorts/aggregates, and only the visible page crosses postMessage.

- `../../packages/incidents/` — shared contracts, worker, pool, tasks, formatting, table metadata
- `../../packages/nextjs/` — Next.js binding re-exporting the generic React bindings
- `../../packages/node/` — node:worker_threads adapter (`createNodePool`, `createNodeWorker`, `node/shim`)
- `src/useIncidents.ts` — composes the bindings with the incident domain
- `src/App.tsx` — TanStack Table UI
- `src/app/` — App Router shell; `page.tsx` mounts the client component
- `src/app/api/atoll/` — **server-side atoll**: a route handler backed by a
  `node:worker_threads` pool (`createNodePool`)
- `src/app/api/jobs/` — **job queue**: fire-and-forget dispatch, progress
  counters read straight from shared memory
- `src/app/api/incidents/` — **read-model API**: stats and records read
  directly off the 1M-record shared buffer; workers own all writes
- `src/instrumentation.ts` — `register()` warms every pool at server boot
  and kicks the incidents seed

## Server-side workers — `/api/atoll`

Next.js route handlers run on Node, so the `@atolljs/node` package
works inside them. `route.ts` creates a 2-worker pool bound to its own tiny
shared contract and exposes a CPU-bound hash task:

```ts
const getPool = (): DigestPool => {
  const g = globalThis as { __atollDigestPool?: DigestPool };
  return (g.__atollDigestPool ??= createNodePool({
    sharedMemory: digestMemory,
    poolSize: 2,
    tasks: { hash: HashDigest },
    // webpack/turbopack detect new Worker(new URL(...)) and emit the entry
    // as its own chunk — the factory points at the TS source.
    createWorker: () => createNodeWorker(
      new Worker(new URL('./atoll.worker.ts', import.meta.url)),
    ),
  }));
};
```

- `POST /api/atoll {"input":"x","rounds":50000}` — chained SHA-256 on a worker
- `GET /api/atoll` — reads `jobsDone` from shared memory, zero dispatch

The `globalThis` singleton survives dev-mode HMR re-evaluation — without it
every hot reload would leak worker threads. The pool getter now lives in
`pool.ts` so `instrumentation.ts` can warm it at boot.

## Job queue — `/api/jobs`

`POST /api/jobs {"count":N,"workMs":50}` writes `queued` on the API thread
and dispatches fire-and-forget; the pool drains jobs on workers which write
`completed`/`lastMs` into shared memory. `GET /api/jobs` reads the counters
directly — progress reporting with zero dispatch and no external queue.

## Read-model API — `/api/incidents`

A 2-worker pool bound to the same `incidentsMemory` contract the browser
demo uses. All writes stay on workers (`seedIncidents` dispatched at boot by
`instrumentation.ts`); every read endpoint is a pure memory read:

- `GET /api/incidents` — `seedProgress` + aggregate `metrics`
- `GET /api/incidents/:id` — `lists.incidents.readAt(id)` — an indexed
  memory read; no worker round-trip, no serialization
- `POST /api/incidents` — dispatch the seed (idempotent; instrumentation
  usually gets there first)

## Boot warmup — `src/instrumentation.ts`

Next.js calls `register()` once when the Node runtime boots. It warms all
three pools and starts the incidents seed so workers spawn during startup
instead of inside the first request. Dynamic imports + the
`NEXT_RUNTIME === 'nodejs'` guard keep `node:worker_threads` out of the
edge/browser bundle graphs.

## Run

```sh
npm install
npm run dev   # http://localhost:3001
```

This app needs a Node runtime — `next dev` / `next start`, a Node host, or a
platform like Vercel. It is intentionally absent from the GitHub Pages deploy
(`scripts/assemble-pages.mjs` mounts only static `dist/` builds): a static
host can't render the pages or answer `/api/atoll`, so the docs site's
embedded demo frame is blank there by design.

SharedArrayBuffer needs cross-origin isolation — `next.config.ts` sets COOP/COEP
headers and aliases `@atolljs/core` to the sdk source (webpack + turbopack).
the shared package's `pool.ts` uses the bundler-detectable
`new Worker(new URL(..., import.meta.url))` pattern via `createWorker`.
The worker pool only constructs on the client (`typeof window` guard in the
data layer), and field observables read `undefined` until the contract binds,
so SSR prerendering is safe.
