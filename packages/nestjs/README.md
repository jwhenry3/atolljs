# @jwhenry123/mesh-nestjs

NestJS bindings for `@jwhenry123/mesh` — worker pools as DI providers on
`node:worker_threads`, with decorator-based method offload.

- `MeshModule.forRoot({ pools? })` / `forRootAsync(...)` — global mesh
  infrastructure, imported once at the root.
- `MeshModule.registerPool(config)` / `registerPoolAsync(...)` — Bull-style
  pool registration inside the feature module that owns the worker;
  injectable via `MESH_POOL:<name>`, terminated on module destroy.
- `@MeshService({ pool })` — class-level offload: every method dispatches to
  the pool under `ClassName.method` ids (a service contract binds only
  declared methods).
- `@MeshTask(taskId | contract | { pool })` — per-method offload. The body
  executes inside the worker's own Nest context on the DI-resolved provider.
- `@InjectMeshPool(name)` — parameter decorator injecting a configured pool.
- `runMeshWorker(AppModule)` — the whole worker entry: boots a Nest
  application context inside the worker, discovers `@MeshTask` providers via
  `DiscoveryService`, binds them into `TaskRegistry`.
- `registerMeshHandlers(...instances)` — explicit registration for instances
  created outside a worker Nest context; `bindMeshWorkerInstance(ctor,
  instance)` binds a DI-resolved instance for worker-side dispatch.

Peer dependencies: `@nestjs/common`, `@nestjs/core`, `reflect-metadata`,
`rxjs`, `@jwhenry123/mesh`, `@jwhenry123/mesh-node`.
