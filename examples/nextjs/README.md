# Telecom Incident Explorer — Next.js

The incidents demo on the `@atolljs/core/sdk` sdk: 1M fixed-layout records seeded into
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
every hot reload would leak worker threads.

## Run

```sh
npm install
npm run dev   # http://localhost:3001
```

SharedArrayBuffer needs cross-origin isolation — `next.config.ts` sets COOP/COEP
headers and aliases `@atolljs/core/sdk` to the sdk source (webpack + turbopack).
the shared package's `pool.ts` uses the bundler-detectable
`new Worker(new URL(..., import.meta.url))` pattern via `createWorker`.
The worker pool only constructs on the client (`typeof window` guard in the
data layer), and field observables read `undefined` until the contract binds,
so SSR prerendering is safe.
