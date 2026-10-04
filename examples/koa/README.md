# Telecom Incident Explorer — Koa

Islands-based multithreading on the server side, no framework adapter needed: a Koa
REST API backed by a `WorkerPool` of `node:worker_threads` workers
(`@atolljs/node`), all bound to the same 1M-record shared-memory contract.

## Endpoints

| Method | Path | Runs on |
|--------|------|---------|
| `POST` | `/api/incidents/seed` | pool task — re-seeds 1M records (also runs automatically at boot) |
| `GET`  | `/api/incidents/seed-progress` | API thread — reads the shared counter |
| `GET`  | `/api/incidents/stats` | pool task — `computeMetrics` over shared memory |
| `GET`  | `/api/incidents/query?severity=critical&status=open&limit=50` | pool task — filtered/paged scan |
| `GET`  | `/api/incidents/:id` | API thread — direct record read, zero dispatch |

Filters take names (`severity=critical`, `status=open`, `region=west`,
`service=core`); `sortBy`/`sortDesc`, `offset`/`limit` (max 200) also supported.

## Layout

- `src/incidents.ts` — the pool + typed client + route helpers.
  `createNodePool` adapts `node:worker_threads.Worker` to the DOM surface the
  pool expects; `workerClient<IncidentsWorker>` makes task calls read like the
  worker's own method names.
- `src/incidents.worker.ts` — the worker entry: `@atolljs/node/shim` first
  (binds `self = parentPort` before `workerBootstrap` evaluates), then the
  incidents worker module for its task-registration side effect.
- `src/main.ts` — thin HTTP adapter; dispatches pool tasks or reads shared
  memory directly.

## Worker bundling

`node:worker_threads` spawns a fresh plain-Node process per worker — loader
hooks (tsx, tsconfig `paths`) do not propagate. So the worker entry is bundled
once by esbuild (`npm run bundle` → `dist/incidents.worker.js`), which resolves
the repo's `@atolljs/*` source aliases inline. The API code itself runs
unbundled under tsx; `npm run dev` bundles the worker then `tsx watch`es the
app — restart `npm run dev` to rebuild the worker after editing it.

## Run

```sh
npm install
npm run dev     # bundle worker + tsx watch → http://localhost:3203
npm run build   # tsc --noEmit + esbuild worker bundle → dist/
npm start       # bundle + tsx src/main.ts
```

Try it:

```sh
curl localhost:3203/api/incidents/stats
curl "localhost:3203/api/incidents/query?severity=critical&status=open&limit=5"
curl localhost:3203/api/incidents/42
curl -X POST localhost:3203/api/incidents/seed
curl localhost:3203/api/incidents/seed-progress
```

No COOP/COEP needed — Node always allows `SharedArrayBuffer`. The buffer is
in-process: every restart gets a fresh, zeroed `SharedArrayBuffer`.
