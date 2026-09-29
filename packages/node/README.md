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

`SharedArrayBuffer` works in Node with no headers — cross-origin isolation is a
browser-only requirement.
