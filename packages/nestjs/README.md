# @atolljs/nestjs

[![CI](https://github.com/jwhenry3/atolljs/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jwhenry3/atolljs/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jwhenry3/atolljs/graph/badge.svg?branch=main)](https://codecov.io/gh/jwhenry3/atolljs)
[![Socket Badge](https://badge.socket.dev/npm/package/@atolljs/nestjs)](https://badge.socket.dev/npm/package/@atolljs/nestjs)

NestJS bindings for `@atolljs/core` — worker pools as DI providers on
`node:worker_threads`, with decorator-based method offload. Named pools share
memory with the API thread, and `@AtollService`/`@AtollTask` move a service
method's body into a worker — with real dependency injection on both sides.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)**

## Install

```bash
npm install @atolljs/core @atolljs/node @atolljs/nestjs
```

## Usage

```ts
// digest.module.ts — the feature module owns its worker domain; the pool
// registers here, not in AppModule
import { Module } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { AtollModule } from '@atolljs/nestjs';
import { digestMemory, DigestService } from './digest.service';

@Module({
  imports: [
    AtollModule.registerPool({
      name: 'digest',
      // webpack detects new Worker(new URL(...)) and emits the entry as its
      // own chunk — the factory references the TS source, not a dist file.
      worker: () => new Worker(new URL('../digest.worker.ts', import.meta.url)),
      sharedMemory: digestMemory,
      poolSize: 2,
    }),
  ],
  providers: [DigestService],
  exports: [DigestService, AtollModule],   // re-exports the pool token
})
export class DigestAtollModule {}

// app.module.ts:  imports: [AtollModule.forRoot(), DigestAtollModule]
```

```ts
// digest.service.ts — the decorator picks the thread
import { Injectable } from '@nestjs/common';
import { AtollService } from '@atolljs/nestjs/decorators';
import { defineSharedMemory, field } from '@atolljs/core';

export const digestMemory = defineSharedMemory({ jobsDone: field.number() });

@Injectable()
@AtollService({ pool: 'digest' })   // EVERY method dispatches to the pool
export class DigestService {
  async hash(input: string, rounds = 50_000) {
    // body executes inside the worker's own Nest context — injected
    // dependencies resolve there too
    let digest = input;
    for (let i = 0; i < rounds; i++) {
      digest = createHash('sha256').update(digest).digest('hex');
    }
    digestMemory.jobsDone.write(digestMemory.jobsDone.read() + 1);
    return { hash: digest, rounds };
  }
}
```

```ts
// digest.worker.ts — the whole worker entry: boots a Nest application
// context inside the worker and registers every @AtollTask/@AtollService
// method on its DI-resolved provider
import { runAtollWorker } from '@atolljs/nestjs/worker';
import { DigestAtollModule } from './digest/digest.module';

void runAtollWorker(DigestAtollModule);
```

```ts
// controller — inject the pool, wrap it as a typed client
import { Controller, Get } from '@nestjs/common';
import { InjectAtollPool } from '@atolljs/nestjs';
import { workerClient, type WorkerPool } from '@atolljs/core';

@Controller('api/digest')
export class DigestController {
  constructor(@InjectAtollPool('digest') private readonly pool: WorkerPool) {}

  @Get('jobs')
  jobs() {
    return this.pool.runTask('DigestService.hash', 'payload');
  }
}
```

## API

- `AtollModule.forRoot({ pools? })` / `forRootAsync(...)` — global atoll
  infrastructure, imported once at the root.
- `AtollModule.registerPool(config)` / `registerPoolAsync(...)` — Bull-style
  pool registration inside the feature module that owns the worker;
  injectable via `ATOLL_POOL:<name>`, terminated on module destroy.
- `@AtollService({ pool })` — class-level offload: every method dispatches to
  the pool under `ClassName.method` ids (a service contract binds only
  declared methods).
- `@AtollTask(taskId | contract | { pool })` — per-method offload. The body
  executes inside the worker's own Nest context on the DI-resolved provider.
- `@InjectAtollPool(name)` — parameter decorator injecting a configured pool.
- `workerClient<WorkerDef>(runner | () => runner)` — typed proxy over an
  injected pool; call the worker's own method names.
- `runAtollWorker(AppModule)` — the whole worker entry: self-contained (shim +
  bootstrap inside), boots a Nest application context in the worker and binds
  every decorated method into the task registry.
- `registerAtollHandlers(...instances)` / `bindAtollWorkerInstance(ctor, instance)`
  — explicit registration for instances created outside a worker Nest context.

**Housed APIs**: give worker-housed routes their own pool + worker entry —
a message-only pool whose workers receive another pool's `sharedBuffer` via
`withSharedBuffer`/`bindSharedBuffer` (`@atolljs/node`), then boot a full
HTTP-bound Nest app
(`NestFactory.create(HousedModule)` + `app.init()` +
`serveHttp(app.getHttpServer(), { listen: 0 })` from `@atolljs/node/http`)
while the main app mounts `proxyToWorker` for the route prefix. The
subtree's controllers and DI then exist only inside workers — see
`examples/nestjs/src/housed/housed.worker.ts` + `src/housed` and
`docs/frameworks/nestjs.md`.

Peer dependencies: `@nestjs/common`, `@nestjs/core`, `reflect-metadata`,
`rxjs`, `@atolljs/core`, `@atolljs/node`.

## Notes

- Server-only binding — `SharedArrayBuffer` in Node needs no COOP/COEP headers.
- Plain `nest build` works: webpack mode detects each
  `new Worker(new URL('./x.worker.ts', import.meta.url))` in the pool config
  and compiles it as its own chunk.
- Each pool's workers share one buffer — only define the pool's own contracts
  in a worker entry's module graph.
- Args/results cross `postMessage` (structured clone); the shared buffer
  carries the large state.

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)
- [NestJS guide](https://jwhenry3.github.io/atolljs/consumer/fw-nestjs/)
