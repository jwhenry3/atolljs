# Telecom Incident Explorer — Next.js

The incidents demo on the `@jwhenry123/mesh/sdk` sdk: 1M fixed-layout records seeded into
shared memory by a worker pool; the main thread publishes queries, the worker
scans/sorts/aggregates, and only the visible page crosses postMessage.

- `../../packages/incidents/` — shared contracts, worker, pool, tasks, formatting, table metadata
- `../../packages/nextjs/` — Next.js binding re-exporting the generic React bindings
- `src/useIncidents.ts` — composes the bindings with the incident domain
- `src/App.tsx` — TanStack Table UI
- `src/app/` — App Router shell; `page.tsx` mounts the client component

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
