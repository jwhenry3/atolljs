# @atolljs/node

`node:worker_threads` runtime adapter for `@atolljs/core` — lets `WorkerPool`
and `connectWorker` run on Node's Worker (an EventEmitter) instead of the DOM
surface they expect.

- `createNodePool({ worker, sharedMemory?, tasks?, … })` — `WorkerPool` with the
  adapter baked in. The `worker:` factory may return a `node:worker_threads.Worker`
  directly, so `new Worker(new URL('./x.worker.ts', import.meta.url))` stays
  bundler-detectable.
- `createNodeWorker(nodeWorker)` / `NodeWorkerAdapter` — wraps a Node Worker for
  `connectWorker` or a hand-built `WorkerPool`.
- `@atolljs/node/shim` — worker-side entry shim; imports first and binds
  `self = parentPort` before `defineWorker`'s bootstrap evaluates.
- `withSharedBuffer` + `bindSharedBuffer` — share one contract buffer across
  pools. Wrap a worker factory with `withSharedBuffer(spawn, bufferOrThunk)`
  so every spawn is fed `pool.sharedBuffer` (thunk evaluated per spawn —
  respawns included); the worker entry `await`s `bindSharedBuffer()` to bind
  all contracts. For message-only pools whose workers read another pool's
  memory.
- `@atolljs/node/http` — two offload topologies:
  - `routeHttpConnections` (Node ≥ 26): the main thread accepts TCP
    connections with `pauseOnConnect` and transfers each `net.Socket` to a
    pool worker, where `serveHttp` feeds it into an `http.Server` owned by
    the worker — parsing, routing, and serialization all off-thread.
  - `routeHttpGateway` (any Node): path-level ownership — the main thread
    parses HTTP once and proxies matched prefixes to worker-owned internal
    listeners (`serveHttp(app, { listen: 0 })`). Pin `/api/a/*` to worker A,
    `/api/b/*` to worker B, serve the rest on main. For embedding into a
    host framework, `workerHttpPorts` + `proxyToWorker` expose the same
    machinery as mountable middleware (see `examples/nestjs` housed API).
  See `examples/http-offload` and `docs/frameworks/node.md`.

`SharedArrayBuffer` works in Node with no headers — cross-origin isolation is a
browser-only requirement.

```ts
// main thread
const routed = routeHttpConnections({ pool, port: 3204 });   // accept + transfer sockets

// worker entry (after '@atolljs/node/shim')
serveHttp(app);   // any (req,res) handler / http.Server — lifecycle stays in-worker
```
