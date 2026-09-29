# Telecom Incident Explorer — Angular

The incidents demo on the `@atolljs/core` sdk: 1M fixed-layout records seeded into
shared memory by a worker pool; the main thread publishes queries, the worker
scans/sorts/aggregates, and only the visible page crosses postMessage.

- `../../packages/incidents/` — shared contracts, worker, pool, tasks, formatting, table metadata
- `../../packages/angular/` — generic Angular signal bindings (`sharedValue`, `taskState`)
- `src/app.component.ts` — composes bindings with the incident domain; query controls and derived view state
- `src/app.component.html` — table UI (zoneless, `@if`/`@for` control flow)

## Run

```sh
npm install
npm run dev   # http://localhost:4201
```

SharedArrayBuffer needs cross-origin isolation — `angular.json` sets COOP/COEP
headers on the dev server, and the shared package's `pool.ts` uses the bundler-detectable
`new Worker(new URL(..., import.meta.url))` pattern via `createWorker`.
The sdk is consumed through the `@atolljs/core` tsconfig path → `../../src`.
