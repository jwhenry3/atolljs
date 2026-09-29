# NestJS — `@atolljs/nestjs` (+ `@atolljs/node`)

Read when: working on `packages/nestjs/`, `packages/node/`, or
`examples/nestjs/`.

`@atolljs/nestjs` — worker pools on the server. Decorated service
methods become RPC endpoints into `node:worker_threads` workers that each boot
their own Nest application context — same module, real DI, both sides.
`@atolljs/node` underneath adapts Node's `Worker` (an EventEmitter) to
the DOM surface the pool expects — see [../tasks-and-pool.md](../tasks-and-pool.md#node-workers).

## Binding API

| Export | Signature | What it does |
|---|---|---|
| `AtollModule.forRoot` | `forRoot({ pools? })` / `forRootAsync(...)` | Global atoll infrastructure once — validator, discovery, lifecycle. Optional pools for simple apps; feature modules prefer `registerPool`. |
| `AtollModule.registerPool` | `registerPool(config)` / `registerPoolAsync(...)` | Bull-style module-level pool registration inside the feature module that owns the worker: name, worker, sharedMemory, poolSize. Injectable provider, terminated on module destroy. |
| `@AtollTask` | `@AtollTask(taskId \| contract \| { pool })` | Per-method RPC offload — main-thread calls dispatch to the named pool; the body executes inside the worker's Nest context on the DI-resolved instance. |
| `@AtollService` | `@AtollService({ pool })` / `@AtollService(service, opts?)` | Class-level offload — marks every method for dispatch to the pool under `ClassName.method` ids (the contract form binds only methods declared in a `ServiceContract`). |
| `@InjectAtollPool` | `@InjectAtollPool(name)` | Parameter decorator injecting a configured pool for first-class task methods / `runTask`. |
| `runAtollWorker` | `runAtollWorker(module): Promise<INestApplicationContext>` | Worker-side bootstrap — self-contained (shim + bootstrap inside). Creates a Nest application context, discovers `@AtollTask` providers via DiscoveryService, binds them into `TaskRegistry`. |
| `registerAtollHandlers` | `registerAtollHandlers(...instances)` | Explicit registration for instances created outside a worker Nest context. |
| worker spec | `worker: path \| URL \| (() => Worker \| NodeWorker)` | Pool worker declaration — a factory may return `node:worker_threads.Worker` directly; it is adapted internally, so `new Worker(new URL(...))` stays webpack-detectable without adapter ceremony. |

## Shape

One module call wires every pool: each becomes an injectable provider,
registers in the pool registry `@AtollTask` dispatches through, and terminates
on module destroy. Source: `packages/nestjs/src/module.ts`.

`@AtollTask`/`@AtollService` — the decorator decides the thread. Main thread:
the call serializes args and dispatches `EXECUTE_TASK` to the pool. Worker
side: the decorator only records metadata — `runAtollWorker` binds the real
body to the DI-created instance. `@AtollService({ pool })` applies that
dispatch to every method on the class; `@AtollTask` remains for per-method
control. Source: `packages/nestjs/src/decorators.ts`.

`runAtollWorker` — the worker boots its own application context and discovers
decorated providers, so injected dependencies resolve inside worker-run
bodies. Source: `packages/nestjs/src/worker.ts`.

Usage references: `examples/nestjs/src/shared/incidents-analytics.service.ts`
(one service, two runtimes — the same class file is the contract),
`examples/nestjs/src/incidents.controller.ts` (injected pool wrapped once with
`workerClient<IncidentsWorker>` — calls read like the worker's own method
names), `examples/nestjs/src/digest.worker.ts` (worker entry: two imports —
`runAtollWorker` plus the feature module).

## Build — plain `nest build`

No custom build script: `nest-cli.json` sets `"webpack": true` and webpack
does the rest — the pool config's `worker:` factory returns
`new Worker(new URL('./x.worker.ts', import.meta.url))`, which webpack
detects, compiling each worker entry as its own chunk and rewriting the URL
to the emitted file, so the config references the TS source directly. The
`node:worker_threads` shim and bootstrap are self-contained in
`atoll-nestjs/worker` — no bundler banner needed.

`examples/nestjs/webpack.config.js` exists only to add `TsconfigPathsPlugin`
for the repo's `@atolljs/*` source aliases — a consumer installing the
published package needs no config factory, just `"webpack": true`.

## Notes

- No COOP/COEP needed — Node always allows `SharedArrayBuffer`.
- `nest build` (webpack/ts-loader) honors `emitDecoratorMetadata`; explicit
  `@Inject` tokens are optional but harmless.
- Keep worker entry imports free of main-thread side effects; only the pool's
  own contracts should be defined in its module graph (each pool hands its
  workers one buffer).
- Args/results cross postMessage — keep them small; big data lives in the
  shared buffer.
