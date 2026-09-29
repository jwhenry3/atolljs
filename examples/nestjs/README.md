# Telecom Incident Explorer — NestJS

The worker atoll on the server side: a NestJS REST API backed by a `WorkerPool`
of `node:worker_threads` workers, all bound to the same 1M-record shared-memory
contract. Services marked `@AtollTask` execute **inside a worker's own Nest
application context** — one module, symmetric boundaries, RPC-style calls.

## Endpoints

| Method | Path | Runs on |
|--------|------|---------|
| `POST` | `/api/incidents/seed` | pool task — re-seeds 1M records (also runs automatically at boot) |
| `GET`  | `/api/incidents/seed-progress` | API thread — reads the shared counter |
| `GET`  | `/api/incidents/stats` | pool task — `computeMetrics` over shared memory |
| `GET`  | `/api/incidents/query?severity=critical&status=open&limit=50` | pool task — filtered/paged scan |
| `GET`  | `/api/incidents/hotspots?limit=10` | **`@AtollTask` — service body runs in a worker's Nest context** |
| `GET`  | `/api/incidents/region-rollup` | **`@AtollTask` — service body runs in a worker's Nest context** |
| `GET`  | `/api/incidents/worker-telemetry` | **`@AtollTask` — reports the answering worker's own injected state** |
| `GET`  | `/api/incidents/:id` | API thread — direct record read, zero dispatch |
| `POST` | `/api/digest/hash` `{input, rounds}` | **`@AtollTask` — SHA-256 chain on the second (`digest`) pool** |
| `GET`  | `/api/digest/status` | API thread — reads the digest pool's own shared counter |
| `GET`  | `/api/digest/worker` | **`@AtollTask` — the answering worker's `threadId` + its own telemetry** |
| `GET`  | `/api/housed/incidents/whoami` | **housed in workers** — proxied; no main-thread controller at all |
| `GET`  | `/api/housed/incidents/stats` | housed in workers — `computeMetrics` inside the worker |
| `GET`  | `/api/housed/incidents/query` | housed in workers — filtered/paged scan inside the worker |
| `GET`  | `/api/housed/incidents/hotspots` | housed in workers — `IncidentsAnalytics` via the worker's own DI |
| `GET`  | `/api/housed/incidents/worker-telemetry` | housed in workers — per-worker injected state |

Filters take names (`severity=critical`, `status=open`, `region=west`,
`service=core`); `sortBy`/`sortDesc`, `offset`/`limit` (max 200) also supported.

## The architecture — symmetric Nest applications

```
main thread                          worker thread (x poolSize)
┌──────────────────────────┐         ┌──────────────────────────┐
│ NestApplication          │  SAB    │ NestApplicationContext   │
│  IncidentsController ────┼─await──▶│  IncidentsAnalytics      │
│    analytics.hotspots()  │ EXECUTE │    ├─ telemetry: DI'd!   │
│  IncidentsAnalytics ─────┼─proxy──▶│    └─ runs method body   │
│  IncidentsAtollModule     │_TASK    │  IncidentsAtollModule     │
└──────────────────────────┘         └──────────────────────────┘
         same shared module + service file on both sides
```

The same `IncidentsAnalytics` class is declared once (`src/shared/`). The main
app imports `IncidentsAtollModule` alongside `AtollModule.forRoot`; each worker
boots its own application context from the same module via `runAtollWorker`.
Calling `analytics.hotspots(3)` on the API thread looks like a normal async
call — the `@AtollTask` decorator decides which side executes it:

```ts
@Injectable()
export class IncidentsAnalytics {
  // Real DI — resolves inside the worker context too.
  constructor(@Inject(ScanTelemetry) private telemetry: ScanTelemetry) {}

  @AtollTask({ pool: 'incidents' })   // API call → EXECUTE_TASK → worker body
  async hotspots(limit?: number) { …scan shared memory… }
}
```

## Housing a partial API inside workers — `src/housed/` (incl. `housed.worker.ts`)

`/api/housed/*` has **no controller on the API thread at all**. A dedicated
`'housed'` pool (own worker entry, `poolSize: 2`) runs a real Nest app —
`NestFactory.create(HousedApiModule)` + `serveHttp(app.getHttpServer(), {
listen: 0 })` binds an internal `127.0.0.1` port and announces it to the
parent. The main app mounts `proxyToWorker` for that prefix — HTTP parsing
and proxying happen on main, but the whole controller stack executes inside
a worker:

```
GET /api/housed/incidents/stats
  → main thread: parse once, proxy to housed worker N's internal port
    → worker: Nest routes it → HousedIncidentsController + DI → response
```

The housed pool is **message-only** — a pool's `sharedMemory` would create a
*second* buffer, so its workers instead read the incidents pool's
`sharedBuffer`, threaded in via `withSharedBuffer`/`bindSharedBuffer`
(`@atolljs/node`). Two pools'
workers, one buffer.

Because housed controllers live in a real Nest app, they inject providers
normally — `IncidentsAnalytics`'s `@AtollService` methods find an empty pool
registry in-worker and run their real bodies, so `worker-telemetry` reports
genuinely per-worker state. Works on any Node version (no socket transfer).

## A second pool is nearly free — `src/digest/`

The `digest` pool demonstrates the marginal cost of adding another worker to
the atoll. Four things, none touching the incidents code:

```ts
// digest.module.ts — the module owns its pool; AppModule just imports it
AtollModule.registerPool({
  name: 'digest',
  worker: () => new Worker(new URL('./digest.worker.ts', import.meta.url)),
  sharedMemory: digestMemory,   // its own tiny contract — separate buffer
  poolSize: 2,
}),
```

The `worker:` factory references the **TS source** — webpack detects
`new Worker(new URL(...))`, compiles the entry as its own chunk, and rewrites
the URL to the emitted file. No dist filename coupling.

- `digest.service.ts` — a small `defineSharedMemory({ jobsDone })` contract
  plus a `@AtollTask({ pool: 'digest' })` service (injected deps work too)
- `digest.module.ts` — the application boundary, imported by AppModule and
  bootstrapped in the worker via `runAtollWorker`
- `digest.controller.ts` — routes (`/api/digest/*`)
- `digest/digest.worker.ts` — 4-line entry: `node/shim` + `workerBootstrap` imports +
  `runAtollWorker(DigestAtollModule)`. Referenced by the pool's `createWorker`
  factory; webpack emits it as its own chunk automatically.

Each pool gets its own shared buffer and its own worker bundle — the digest
workers' 100KB contract carries just `jobsDone`, while `/api/digest/status`
reads it on the API thread for free. Hit `/api/digest/worker` and you get
`threadId` 25–26 (threads 1–24 are the incidents pool) — proof of which
thread ran the method.

## The `@atolljs/nestjs` binding

- **`AtollModule.forRoot({ pools })`** — one `WorkerPool` per entry; pools are
  injectable (`@InjectAtollPool(name)`), registered for `@AtollTask` dispatch,
  and terminated on module destroy.
- **`@AtollTask(taskId | contract | { pool })`** — RPC-style offload. Main:
  call → `EXECUTE_TASK` → result Promise. Worker: metadata is recorded for
  `runAtollWorker` to discover.
- **`runAtollWorker(module)`** — worker-side bootstrap
  (`@atolljs/nestjs/worker`): creates a Nest application context,
  discovers decorated providers via `DiscoveryService`, registers each method
  into `TaskRegistry` **bound to the DI-created instance**. Injected
  dependencies work inside worker-run bodies.
- **`createNodeWorker`** — from `@atolljs/node`: adapts
  `node:worker_threads.Worker` to the DOM `Worker` surface `WorkerPool`
  expects (also re-exported from the nestjs subpath).
- **`@atolljs/node`** — the Node runtime layer itself:
  `createNodePool` (WorkerPool + adapter, no Nest needed),
  `NodeWorkerAdapter`, and `node/shim` (the `self = parentPort` first-import
  for worker entries).
- **`registerAtollHandlers(...)`** — explicit registration for instances
  created outside a worker Nest context.

Method args/results cross `postMessage` — keep them structured-cloneable and
small; the big data lives in the shared buffer both sides already see.
HTTP concerns (request parsing, param decorators) stay on the API thread —
the worker only ever sees plain method arguments.

## Layout

- `src/incidents.controller.ts` — thin HTTP adapter; calls the service
- `src/shared/incidents-atoll.module.ts` — module imported by both contexts
- `src/shared/incidents-analytics.service.ts` — `@AtollTask` methods (worker code)
- `src/shared/scan-telemetry.service.ts` — injected dep (per-worker state)
- `src/shared/incidents.worker.ts` — incidents worker entry: built-in task handlers +
  `runAtollWorker(IncidentsAtollModule)`
- `src/digest/` — second pool: contract + service + module + controller
- `src/digest/digest.worker.ts` — digest worker entry: `runAtollWorker(DigestAtollModule)`
- `nest-cli.json` + `webpack.config.js` — plain `nest build` in webpack mode.
  The factory only adds `TsconfigPathsPlugin` for the `@atolljs/core/*`
  aliases; worker chunks are detected from `new Worker(new URL('./x.worker.ts',
  import.meta.url))` in the pool configs. Each worker entry's first import is
  `@atolljs/node/shim`, which binds `globalThis.self = parentPort`
  before `workerBootstrap` wires the MessagePort — no bundler banner needed.
  `@Inject…` tokens are used throughout — ts-loader honors
  `emitDecoratorMetadata`, so they're belt-and-suspenders rather than
  required.
- No COOP/COEP needed — Node always allows `SharedArrayBuffer`.
- The buffer is in-process: every restart gets a fresh, zeroed
  `SharedArrayBuffer`. `SeedOnBootstrap` (app.module.ts) runs `seedIncidents`
  at boot so the API never serves an empty store — `POST /seed` remains for
  manual re-seeding.

## Run

```sh
npm install
npm run dev     # nest start --watch → http://localhost:3100
npm run build   # tsc --noEmit + nest build (webpack) → dist/
npm start       # node dist/main.js
```

Try it:

```sh
curl -X POST localhost:3100/api/incidents/seed
curl "localhost:3100/api/incidents/hotspots?limit=5"
curl localhost:3100/api/incidents/worker-telemetry   # hit repeatedly — each
                                                    # worker reports its own
curl localhost:3100/api/incidents/stats

curl -X POST localhost:3100/api/digest/hash -d '{"input":"x","rounds":80000}'
curl localhost:3100/api/digest/status               # counter grew — free read
curl localhost:3100/api/digest/worker               # threadId 25/26: pool #2
```
