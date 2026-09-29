# @atolljs/nestjs

NestJS bindings for `@atolljs/core` — worker pools as DI providers on
`node:worker_threads`, with decorator-based method offload.

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
- `runAtollWorker(AppModule)` — the whole worker entry: boots a Nest
  application context inside the worker, discovers `@AtollTask` providers via
  `DiscoveryService`, binds them into `TaskRegistry`.
- `registerAtollHandlers(...instances)` — explicit registration for instances
  created outside a worker Nest context; `bindAtollWorkerInstance(ctor,
  instance)` binds a DI-resolved instance for worker-side dispatch.

**Housed APIs**: give worker-housed routes their own pool + worker entry —
a message-only pool whose workers receive another pool's `sharedBuffer` via
`withSharedBuffer`/`bindSharedBuffer` (`@atolljs/node`), then boot a full
HTTP-bound Nest app
(`NestFactory.create(HousedModule)` + `app.init()` +
`serveHttp(app.getHttpServer(), { listen: 0 })` from `@atolljs/node/http`)
while the main app mounts `proxyToWorker` for the route prefix. The
subtree's controllers and DI then exist only inside workers — see
`examples/nestjs/src/housed.worker.ts` + `src/housed` and
`docs/frameworks/nestjs.md`.

Peer dependencies: `@nestjs/common`, `@nestjs/core`, `reflect-metadata`,
`rxjs`, `@atolljs/core`, `@atolljs/node`.
