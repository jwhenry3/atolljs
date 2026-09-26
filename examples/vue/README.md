# Telecom Incident Explorer — Vue

The incidents demo on the `@jwhenry123/mesh/sdk` sdk: 1M fixed-layout records seeded into
shared memory by a worker pool; the main thread publishes queries, the worker
scans/sorts/aggregates, and only the visible page crosses postMessage.

- `../../packages/incidents/` — shared contracts, worker, pool, tasks, formatting, table metadata
- `../../packages/vue/` — generic Vue bindings (`useSharedValue`, `useTask`, `useObservable`)
- `src/useIncidents.ts` — composes the bindings with the incident domain
- `src/App.vue` — table UI

## Run

```sh
npm install
npm run dev   # http://localhost:5174
```

SharedArrayBuffer needs cross-origin isolation — the vite config sets COOP/COEP
headers, and the shared package's `pool.ts` uses the bundler-detectable
`new Worker(new URL(..., import.meta.url))` pattern via `createWorker`.
