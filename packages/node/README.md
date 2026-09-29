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

## Notes

- `SharedArrayBuffer` works in Node with no headers — cross-origin isolation
  is a browser-only requirement.
- Building a NestJS app? [`@atolljs/nestjs`](../nestjs) wraps this adapter in
  DI providers and decorator-based method offload.

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)
- [Node backends — Express, Fastify, Hono, Koa](https://jwhenry3.github.io/atolljs/consumer/#/fw-node)
- [Worker pool & tasks](https://jwhenry3.github.io/atolljs/consumer/#/tasks)
- [NestJS guide](https://jwhenry3.github.io/atolljs/consumer/#/fw-nestjs)
