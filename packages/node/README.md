# @atolljs/node

`node:worker_threads` runtime adapter for `@atolljs/core` — lets `WorkerPool`
and `connectWorker` run on Node's `Worker` (an `EventEmitter`) instead of the
DOM surface they expect. No framework required.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)**

## Install

```bash
npm install @atolljs/core @atolljs/node
```

## Usage

```ts
// pool.ts — a WorkerPool backed by node:worker_threads
import { Worker } from 'node:worker_threads';
import { createNodePool } from '@atolljs/node';
import { counterMemory } from './counter.memory';

export const pool = createNodePool({
  // The factory may return a node:worker_threads.Worker directly — the
  // adapter wraps it, so new Worker(new URL(...)) stays bundler-detectable.
  worker: () => new Worker(new URL('./counter.worker.js', import.meta.url)),
  sharedMemory: counterMemory,
  poolSize: 4,
});
```

```ts
// counter.worker.ts — the worker entry; the shim binds self = parentPort
// before defineWorker's bootstrap evaluates, so import it first.
import '@atolljs/node/shim';
import { defineWorker } from '@atolljs/core';
import { counterMemory } from './counter.memory';

export const counterWorker = defineWorker({
  sharedMemory: counterMemory,
  methods: {
    increment(delta: number) {
      const next = counterMemory.count.read() + delta;
      counterMemory.count.write(next);
      return next;
    },
  },
});
```

## API

- `createNodePool({ worker, sharedMemory?, tasks?, … })` — a `WorkerPool` with
  the adapter baked in. `worker` accepts a path/URL or a factory returning
  either a Node or DOM-style `Worker`.
- `createNodeWorker(nodeWorker)` / `NodeWorkerAdapter` — wrap a Node `Worker`
  (or worker file path) for `connectWorker` or a hand-built `WorkerPool`.
- `@atolljs/node/shim` — worker-side entry shim; import first so `self =
  parentPort` is bound before `defineWorker`'s bootstrap evaluates.
- `withSharedBuffer` + `bindSharedBuffer` — share one contract buffer across
  pools. Wrap a worker factory with `withSharedBuffer(spawn, bufferOrThunk)`
  so every spawn is fed `pool.sharedBuffer` (thunk evaluated per spawn —
  respawns included); the worker entry `await`s `bindSharedBuffer()` to bind
  all contracts. For message-only pools whose workers read another pool's
  memory.
- `@atolljs/node/http` — two offload topologies:
  - `createHttpCluster` (Node ≥ 26): the main thread accepts TCP
    connections with `pauseOnConnect` and transfers each `net.Socket` to a
    pool worker, where `serveHttp` feeds it into an `http.Server` owned by
    the worker — parsing, routing, and serialization all off-thread.
  - `routeHttpGateway` (any Node): path-level ownership — the main thread
    parses HTTP once and proxies matched prefixes to worker-owned internal
    listeners (`serveHttp(app, { listen: 0 })`). Pin `/api/a/*` to worker A,
    `/api/b/*` to worker B, serve the rest on main. WebSocket upgrades match
    the same prefixes and are tunneled end-to-end; for embedding into a
    host framework, `workerHttpPorts` + `proxyToWorker` (+`proxyUpgradeToWorker`
    on the server's `upgrade` event) expose the same machinery as mountable
    middleware (see `examples/nestjs` housed API).
  See `examples/http-offload` and `docs/frameworks/node.md`.

## Notes

- `SharedArrayBuffer` works in Node with no headers — cross-origin isolation
  is a browser-only requirement.
- Building a NestJS app? [`@atolljs/nestjs`](../nestjs) wraps this adapter in
  DI providers and decorator-based method offload.

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)
- [Node backends — Express, Fastify, Hono, Koa](https://jwhenry3.github.io/atolljs/consumer/#/fw-node)
- [HTTP offload — worker servers](https://jwhenry3.github.io/atolljs/consumer/#/node-servers)
- [Worker pool & tasks](https://jwhenry3.github.io/atolljs/consumer/#/tasks)
- [NestJS guide](https://jwhenry3.github.io/atolljs/consumer/#/fw-nestjs)
