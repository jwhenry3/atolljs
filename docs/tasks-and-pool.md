# Worker pool & tasks

Read when: working on `src/pool/`, `src/worker/`, `src/service.ts`,
task dispatch, timeouts/cancellation, or `packages/node`.

Tasks are the only message-passing boundary, split the way tRPC splits a
router: the *worker script* owns the runtime and the method list via
`defineWorker`; the main thread imports only its `typeof` and drives it
through a `connectWorker` Proxy client. Method names are listed exactly once.

## One file per method

Each task owns one file under `service/` containing its wire schemas and its
worker implementation as a `serviceMethod` unit — reference:
`packages/incidents/src/service/queryIncidents.ts`. The schemas type `run`'s
parameters — nothing to annotate.

`argsSchema`/`resultSchema` validate at the thread boundary inside the worker —
the trust boundary is the message. Plain functions work too
(`methods: { ping: () => 'pong' }`) when no validation is needed; their
signature types the client directly.

## Worker side

Reference: `packages/incidents/src/worker/incidents.worker.ts`.
`defineWorker` installs the message loop (binds shared memory on
`INIT_MEMORY`, dispatches `EXECUTE_TASK`) and registers every method under its
own name. `services: { pricing: { … } }` namespaces methods as
`pricing.reprice` when one worker hosts several domains. The exported
`IncidentsWorker` type is all the main thread ever imports from this file.

## Main thread — the client

Reference: `packages/incidents/src/incidents.ts`. `import type` keeps worker
code out of the main bundle. The client is a Proxy:
`incidents.queryIncidents(q)` dispatches taskId `"queryIncidents"` to the
pool — typed by the worker's method signatures. The pool spawns lazily on the
first call, so importing the client is SSR-safe; `start()` spawns eagerly,
`terminate()` drops the pool and the next call re-spawns.

### `connectWorker` config

| Option | Notes |
|---|---|
| `worker` | Factory `() => new Worker(new URL(..., import.meta.url), { type: 'module' })` — bundlers only emit worker chunks for the inline form. A `URL` also works. |
| `sharedMemory` | *Optional.* The contract to bind on the main thread and ship to workers, type-checked against the worker's declared `sharedMemory`. Omit for a message-only pool — no `SharedArrayBuffer` or COOP/COEP requirement; the handshake becomes a bare `INIT`. |
| `poolSize` | A number, or `'auto'` (default) for `navigator.hardwareConcurrency ?? 4`. |
| `concurrency` | In-flight cap per worker (default 1); least-busy dispatch, FIFO queue beyond the cap. |
| `maxQueue` | Queue bound; a full queue rejects with `PoolQueueFullError`. |
| `taskTimeout` | Default timeout from enqueue (queue wait + run) → `TaskTimeoutError`. Override per call via `client.with({ timeout })`. |
| `respawn` | Default `true`: crashed workers are replaced; in-flight calls reject with `WorkerCrashedError`. |
| `lazy` | Default `true`. `false` spawns at construction. |

`client.with({ signal, timeout })` returns the same typed surface with
per-call controls; `pool.stats()` exposes queue/in-flight counts and wait/run
aggregates; `pool.workers` exposes a live snapshot of the slot workers for
auxiliary messaging outside task dispatch (respawns appear on the next read —
see [frameworks/node.md](frameworks/node.md) for the socket-routing use);
`pool.sharedBuffer` exposes the buffer handed to workers via INIT_MEMORY
(e.g. to share one contract buffer across two pools — `withSharedBuffer` in
`@atolljs/node` feeds it to each spawned worker);
`pool.close()` drains then terminates. A `signal` abort rejects
the call with `TaskAbortedError` (all four errors are exported from
`@atolljs/core`): a queued call is dropped, an in-flight one rejects
the caller but holds the worker's slot until its reply arrives — JS can't
interrupt a running task, so the pool never double-books a busy worker.

## Under the hood

`connectWorker` builds a `WorkerPool`; `workerClient(runner)` is the bare
Proxy over any `TaskRunner` — a pool you already hold (Nest's
`@InjectAtollPool`), a SharedWorker client, or a test stub. The
explicit-contract path (`TaskContract`, `TaskRegistry.register`,
`defineService`) remains for cases where both threads need the contract object
at runtime.

## Explicit service contracts (advanced)

`defineWorker`/`connectWorker` build on a lower, framework-neutral layer
(`src/service.ts`) — the same one the NestJS binding dispatches through.
Reach for it when both threads need the contract object at runtime — feeding a
hand-built `WorkerPool`, a DI provider, or a test stub:

| Export | What it does |
|---|---|
| `defineService(name, methods)` | Declares the contract bundle once — `{ method: { argsSchema?, resultSchema? } }`. Wire ids derive as `service.method`; signatures infer from the schemas (`argsSchema: z.tuple(...)` → args, `resultSchema` → return type). |
| `implementService(service, handlers)` | Worker-side registration into `TaskRegistry`; throws at bind time on a missing method instead of surfacing "handler not found" on the far thread. |
| `createClient(service, runner)` | The main-thread half — a typed proxy over any `TaskRunner`: a pool, a SharedWorker client, or a test stub. |
| `service.tasks` | A `TaskMap` — feed it straight to `new WorkerPool({ tasks })` or a SharedWorker config. |
| `rpc<A, R>({ taskId? })` | Escape hatch for method declarations schemas can't carry — typed args with no validation, or an explicit wire id for interop. |

```ts
import { defineService, implementService, createClient, rpc } from '@atolljs/core';

// Both threads import the same object — ids can never drift:
export const pricing = defineService('pricing', {
  reprice: { argsSchema: z.tuple([z.string()]), resultSchema: z.number() },
  ping: rpc<[], string>(),                  // no schemas — types declared
});
// pricing.tasks.reprice.taskId === 'pricing.reprice'

// worker side — a missing method throws here, at bind time:
implementService(pricing, { reprice: (sku) => …, ping: () => 'pong' });

// main thread — over any TaskRunner:
const client = createClient(pricing, pool);
await client.reprice('SKU-1');
```

## Node workers

`WorkerPool`/`connectWorker` run on `node:worker_threads` unchanged —
`@atolljs/node` adapts Node's `Worker` (an EventEmitter) to the DOM
surface the pool expects. The worker entry's first import is
`@atolljs/node/shim`, which binds `self = parentPort` before
`defineWorker`'s bootstrap evaluates.

```ts
import { createNodePool, createNodeWorker } from '@atolljs/node';
import { Worker } from 'node:worker_threads';

// createNodePool = new WorkerPool + the adapter baked in. Its worker:
// factory may return a node:worker_threads.Worker directly — adapted
// internally — keeping the bundler-detectable new URL(...) literal:
const pool = createNodePool({
  sharedMemory: memory,
  tasks: pricing.tasks,
  worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
});

// connectWorker / new WorkerPool need the DOM surface — wrap explicitly:
connectWorker<IncidentsWorker>({
  worker: () => createNodeWorker(new Worker('./dist/incidents.worker.js')),
});
```

`SharedArrayBuffer` works in Node with no headers — cross-origin isolation is
a browser-only requirement.
