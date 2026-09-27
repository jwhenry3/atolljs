# Telecom Incident Explorer — Next.js

The incidents demo on the `@jwhenry123/mesh/sdk` sdk: 1M fixed-layout records seeded into
shared memory by a worker pool; the main thread publishes queries, the worker
scans/sorts/aggregates, and only the visible page crosses postMessage.

- `../../packages/incidents/` — shared contracts, worker, pool, tasks, formatting, table metadata
- `../../packages/nextjs/` — Next.js binding re-exporting the generic React bindings
- `../../packages/node/` — node:worker_threads adapter (`createNodePool`, `createNodeWorker`, `node/shim`)
- `src/useIncidents.ts` — composes the bindings with the incident domain
- `src/App.tsx` — TanStack Table UI
- `src/app/` — App Router shell; `page.tsx` mounts the client component
- `src/app/api/mesh/` — **server-side mesh**: a route handler backed by a
  `node:worker_threads` pool (`createNodePool`)

## Server-side workers — `/api/mesh`

Next.js route handlers run on Node, so the `@jwhenry123/mesh-node` package
works inside them. `route.ts` creates a 2-worker pool bound to its own tiny
shared contract and exposes a CPU-bound hash task:

```ts
const getPool = (): DigestPool => {
  const g = globalThis as { __meshDigestPool?: DigestPool };
  return (g.__meshDigestPool ??= createNodePool({
    sharedMemory: digestMemory,
    poolSize: 2,
    tasks: { hash: HashDigest },
    // webpack/turbopack detect new Worker(new URL(...)) and emit the entry
    // as its own chunk — the factory points at the TS source.
    createWorker: () => createNodeWorker(
      new Worker(new URL('./mesh.worker.ts', import.meta.url)),
    ),
  }));
};
```

- `POST /api/mesh {"input":"x","rounds":50000}` — chained SHA-256 on a worker
- `GET /api/mesh` — reads `jobsDone` from shared memory, zero dispatch

The `globalThis` singleton survives dev-mode HMR re-evaluation — without it
every hot reload would leak worker threads.

## Run

```sh
npm install
npm run dev   # http://localhost:3001
```

SharedArrayBuffer needs cross-origin isolation — `next.config.ts` sets COOP/COEP
headers and aliases `@jwhenry123/mesh/sdk` to the sdk source (webpack + turbopack).
the shared package's `pool.ts` uses the bundler-detectable
`new Worker(new URL(..., import.meta.url))` pattern via `createWorker`.
The worker pool only constructs on the client (`typeof window` guard in the
data layer), and field observables read `undefined` until the contract binds,
so SSR prerendering is safe.
