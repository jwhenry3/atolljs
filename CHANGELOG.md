# Changelog

## 0.1.1

HTTP offload topologies for Node, Redis-backed shared-memory persistence, a
framework-neutral islands core, and a consumer-facing docs pass. No breaking
changes to the 0.1.0 API.

### HTTP offload — `@atolljs/node/http` (new)

Two ways to push real HTTP work into `node:worker_threads` pools:

- **Gateway** — `routeHttpGateway({ server, pool, routes })` matches request
  prefixes on the main-thread listener and proxies them to worker-owned HTTP
  servers (`serveHttp(app, { listen: 0 })` inside the worker announces an
  internal port). Unmatched paths stay on the main listener — one port,
  mixed ownership. `proxyToWorker(options)` is the same machinery as
  connect/express-style middleware for embedding in an existing app.
- **Clustering** — `createHttpCluster({ pool, port, route? })` transfers raw
  accepted sockets (`pauseOnConnect`) to workers unparsed; workers run the
  whole HTTP pipeline. Requires Node ≥ 26 (`SOCKET_TRANSFER_SUPPORTED` is
  the capability flag; the call no-ops with a notice otherwise). Routing is
  per-connection, so it lives on a second listener.
- **WebSockets** — upgrades are matched against the same prefix table and
  tunneled to the owning worker (rawHeaders preserved, `host`/path
  rewritten, sockets spliced — the main thread leaves the data path after
  the handshake). Unmatched upgrades go to a new `onUpgrade` fallback or are
  destroyed, preserving Node semantics. `proxyUpgradeToWorker(options)` is
  the `'upgrade'`-listener sibling of `proxyToWorker` for apps that mount
  middleware themselves. Clustered WS needs no extra API — the whole socket
  transfers.
- **Sticky sessions** — `stickyByAddress()` is a `route` for
  `createHttpCluster`: rendezvous hashing on `remoteAddress` pins a client
  to a worker across *separate* connections (socket.io's polling→upgrade,
  HTTP→WS session flows). Worker loss remaps only that worker's clients.
- **Sharing one contract buffer** — `withSharedBuffer(spawn, getBuffer)` +
  `bindSharedBuffer()` (`@atolljs/node`) hand a pool's `SharedArrayBuffer`
  to message-only worker pools (e.g. HTTP workers reading another pool's
  shared memory without a second INIT handshake).

### Shared-memory persistence — `@atolljs/node/redis` (new)

- `persistSharedMemory(memory, { client, name, key?, syncIntervalMs?,
  fields?, subscriber? })` — mirrors a bound contract into Redis. The local
  `SharedArrayBuffer` stays the synchronous source of truth (the contract
  API can't be async); Redis holds per-field bytes as hash members at
  `{key}:{name}` (field path → base64) as the durable/replicated copy.
- A `syncIntervalMs` poll diffs the per-field **version counters** — the
  same Atomics block `observe()` uses — so there is no hot-path write
  instrumentation. `ready` resolves after `hgetall` restores bytes (with
  version bumps so local waiters fire); `flush()` forces a write;
  `stop()` does a final flush.
- Optional **pub/sub replication** (`subscriber`): dirty fields publish
  `{ src, path, b64 }`; subscribers apply bytes + bump local versions —
  echo-suppressed, last-write-wins per field.
- `redisMemoryAdapter(client, opts)` is the pool-config factory:
  `persistence: redisMemoryAdapter(redis)` on `createNodePool` /
  `AtollModule.registerPool(Async)`. `ioRedisSubscriber` adapts ioredis;
  node-redis's `subscribe(ch, listener)` matches natively. The client
  surface is `hset`/`hgetall`/`publish` on strings — no Redis dependency.
- Core seam: `WorkerPoolConfig.persistence?: (memory) => MemoryPersistence`
  (`{ ready, flush, stop }`) — invoked after bind, stopped inside
  `terminate()`. `SharedMemory` gained adapter-facing `buffer` and
  `fields()` accessors; `WorkerPool` exposes `sharedBuffer` and a `workers`
  snapshot for auxiliary messaging.

### Islands — framework-neutral core

- **React moved out.** The react-reconciler host config now lives in
  `@atolljs/react-island/worker` (`reactIslandApp`,
  `defineReactPolyWorker`/`defineReactMonoWorker`); `@atolljs/islands` ships
  no renderer. `definePolyWorker({ apps })` treats every app shape
  uniformly — `{ imperative: (doc, props) => void }`, a framework helper, or
  `{ mount(ctx) }` returning a handle with `update`/`sync`/`flush`/`dispose`.
- **Slots are an attribute, not a component** — host children project into
  the worker tree via `data-atoll-slot`, renderable by any framework;
  React's `<Slot/>` is sugar over it.
- **`@atolljs/islands/metrics`** — flag-gated proxy-engine instrumentation:
  `proxyMs` (engine sinks) vs `appMs` (framework/adapter residual) vs
  `mainMs` (replay), `opBytes` wire estimates, and `proxyInstanceStats()`
  structural counts (retained nodes, handlers, queue depth). Off by
  default; production pays one predictable branch. Powers the generated
  per-framework benchmark table in the consumer docs.
- **Angular facade — `@AngularIsland` + `islandComponent`** —
  `@atolljs/angular-island` now centers on the worker component class as
  the island contract. The `@AngularIsland` class decorator stamps the
  registry name (default `CounterComponent` → `'counter'`) and registers
  the component, so `defineAngularPolyWorker()` collects every decorated
  component with no `apps` map (an `apps` array form names undecorated
  entries the same way; the record form is unchanged). Root
  `output()`/`model()` fields bridge onto the island emit channel under
  their public names (`x = model()` → `'xChange'`) with the adapter
  handling instance re-entry — the component's declared API is the event
  contract. Shell-side, `islandComponent<C>({ app, client|worker,
  selector? })` generates a standalone component (hand-authored `ɵcmp` —
  AOT and JIT safe) whose `[props]`/`onEvent` are typed via
  `IslandInputs<C>`/`IslandEvents<C>`/`IslandEventHandler<C>` off the
  class's `input()`/`model()`/`output()` fields — `import type` keeps the
  worker module out of the bundle. The low-level
  `<atoll-island>`/`[atollIsland]` surface is unchanged except new
  `worker`/`workerOptions`/`mode` inputs (a `connectIslandWorker` call is
  no longer mandatory) and generic typing — `[app]` accepts the stamped
  component class directly.

### Core packaging

- The contract layer vendors a **narrowed zod surface** (`src/contract/zod`)
  — named constructors instead of the `z` namespace, which can't
  property-shake and dragged ~440KB into consumer builds. `mz` output and
  `memory.schemas` are still ordinary zod (classic and mini schemas both
  accepted).

### Examples & docs

- New runnable examples: `examples/express`, `examples/fastify`,
  `examples/hono`, `examples/koa` (framework adapters over a worker pool),
  and `examples/http-offload` (gateway + cluster on one app).
- NestJS example demonstrates **housed APIs** — routes owned entirely
  inside workers, reachable through the gateway or the cluster listener.
- READMEs reworked for npm onboarding; consumer docs
  (`jwhenry3.github.io/atolljs/consumer/`) reorganized — framework sub-pages,
  Islands overview/quickstart/proxy-document pages, per-framework backend
  topics (clustering, gateway routing, WebSockets, persistence), and a
  generated bundle-size/processing-load page.
- 76 test files / 529 tests including real `nest build` → boot → HTTP e2e
  and socket-transfer e2e on Node ≥ 26.

## 0.1.0 — initial release

Typed shared-memory worker pools and worker-rendered UI islands for
TypeScript. The worker file is the contract: `defineWorker` declares the
method surface once, `connectWorker` gives the main thread a typed, lazy
client — and a shared-memory contract can flow live values into UI state
without a single `postMessage` copy. On top of that sits the islands layer:
whole framework apps render inside workers and stream DOM ops to the main
thread.

### Core — `@atolljs/core`

**Worker authoring & clients**

- `defineWorker({ sharedMemory?, methods })` — self-bootstrapping worker
  entry; methods are plain functions or `serviceMethod` units with zod wire
  schemas. Nested `services: { name: { ... } }` namespaces methods as
  `name.method`.
- `connectWorker<typeof worker>({ worker, sharedMemory?, poolSize, … })` —
  typed client proxy over a `WorkerPool`; **lazy spawn** makes it SSR-safe —
  the pool starts on the first call (or `client.start()`), never on import.
- `workerClient(runner)` — wraps any `TaskRunner` you already own in the same
  typed surface. Method proxies are cached, so `client.method` is a stable
  reference safe for `useMemo`/effect deps.

**Pool scheduling & lifecycle**

- Least-busy dispatch, per-worker `concurrency`, FIFO queue with `maxQueue`
  backpressure (`PoolQueueFullError`).
- Per-call cancellation and timeouts: `client.with({ signal, timeout })`.
  In-flight aborts reject the caller immediately (`TaskAbortedError`) while
  the worker's slot stays occupied until its late reply arrives — no
  double-booking.
- Worker crash → in-flight calls reject (`WorkerCrashedError`), worker
  respawns (`respawn: false` shrinks the pool instead). `taskTimeout` default
  with per-call override (`TaskTimeoutError`).
- `pool.stats()` — worker/queue/in-flight counts plus wait & run aggregates;
  `pool.close()` drains then terminates; `terminate()` is immediate.

**Shared memory — opt-in, not required**

- `defineSharedMemory({ field.number(), field.string({ schema }), … })` — one
  declaration is simultaneously the binary layout, the zod validator, and the
  TypeScript type. `mz` schemas (`mz.u32()`, `mz.int(min,max)`,
  `mz.string(bytes)`, `mz.object`, `mz.array`) pick the narrowest fixed-width
  storage; `field.list` lays out fixed-size record arrays (`readAt`/`writeAt`/
  `commit`); `maxBytes` stays as the codec escape hatch for dynamic values.
- Versioned fields: every write bumps an atomic version counter; `observe()`
  parks on `Atomics.waitAsync` (poll fallback) — workers write in place and
  the UI updates with zero message copies.
- Omit `sharedMemory` entirely and the pool is a typed, pooled, cancellable
  worker RPC — bare `INIT` handshake, no `SharedArrayBuffer`, **no COOP/COEP
  headers required**.
- Codecs `jsonCodec`/`msgpackCodec`/`msgpackrCodec`; pluggable storage via
  `registerConnectorFactory` and per-contract `plugins`; `MemoryManager` for
  manual buffer allocation.

**Explicit service layer** (what `defineWorker`/`connectWorker` build on)

- `defineService` / `implementService` / `createClient` / `serviceMethod` /
  `rpc<A, R>` — contract objects both threads can hold at runtime; wire ids
  derive as `service.method`; signatures infer from schemas.

**SharedWorker** — `connectSharedWorker` + `sharedWorkerHost`: one worker
(and one buffer) shared across tabs/iframes.

**Testing** — `InProcessWorker`
(`@atolljs/core/testing/inProcessWorker`) runs the whole protocol
in-process: real task registry, real op stream, real shared-memory binding —
only the thread boundary is faked.

### Islands — worker-rendered UI

**`@atolljs/islands`** — the engine. Main thread: `connectIslandWorker({
worker })` + `mountIsland()` — no framework code on the main thread, just op
replay. Worker side (`@atolljs/islands/worker`): `definePolyWorker({ apps })`
hosts a named island registry in one worker; `defineMonoWorker(app)` dedicates
a worker to a single app.

- `islandApp(...)` stamps worker-side apps; `emit` sends events island → host;
  `callbackProp(fn)` marshals function props as emit-backed callables; `Slot`
  projects host children into the worker tree.
- Op stream rides a shared-memory doorbell (`push`) or plain postMessage
  (`mode: 'poll'` / `doorbell: false` — no `SharedArrayBuffer` needed);
  `mountTimeout` guards against silent worker entries.
- `installDomShim(doc)` sets `globalThis.document` + a `window` facade so
  real DOM-dependent libraries run unmodified in the worker: `innerHTML`
  parses via htmlparser2, delegated `listen` ops, `outerHTML`,
  `insertAdjacentHTML`, `cloneNode`, `closest`/`matches`, and friends on the
  proxy DOM.

**Per-framework island packages** — each ships a host-side mount and worker
helpers (`define<Fw>PolyWorker` / `define<Fw>MonoWorker`):

| Package | Host API |
|---|---|
| `@atolljs/react-island` | `<Island/>`, `islandComponent`, `lazyIsland` (Suspense code-splitting) |
| `@atolljs/vue-island` | `<AtollIsland/>`, `useIsland`, `vueIsland` |
| `@atolljs/svelte-island` | `<AtollIsland/>` component, `svelteIsland` |
| `@atolljs/solid-island` | `createIsland`, `Island`, `islandComponent`, `lazyIsland` |
| `@atolljs/angular-island` | `<atoll-island>` component + `[atollIsland]` directive |

### Framework bindings — independently published

| Package | API |
|---|---|
| `@atolljs/react` | `useObservable`, `useSharedValue`, `useTask` |
| `@atolljs/vue` | `useObservable`, `useSharedValue`, `useTask` |
| `@atolljs/solidjs` | `createObservable`, `createSharedValue`, `createTask` |
| `@atolljs/svelte` | `observableValue`, `sharedValue`, `taskState` (runes) |
| `@atolljs/angular` | `observableSignal`, `sharedValue`, `taskState` (signals), `provideAtoll`, `injectAtollPool` |
| `@atolljs/nextjs` | React hooks re-exported for App Router client components |

Every task binding accepts an `AsyncTask` **or a plain async function** — a
client method like `useTask(incidents.queryIncidents)` binds directly, with
per-call-site task state (no module-global latest-wins clobbering).

**Angular** also ships `AtollModule` — the Nest vocabulary for NgModule apps:
`forRoot`/`forRootAsync` at the root, `registerPool`/`registerPoolAsync`
inside the feature module that owns the worker, `@InjectAtollPool` for
ctor-param injection. Pools terminate on injector destroy (teardown/HMR).

### Server side

- `@atolljs/node` — `createNodePool` (auto-adapts
  `node:worker_threads.Worker`), `createNodeWorker`, the `/shim` worker entry
  (`self = parentPort`). No isolation headers needed on Node.
- `@atolljs/nestjs` — `AtollModule.forRoot/forRootAsync` +
  `registerPool/registerPoolAsync` (feature-module-owned pools, Bull-style);
  `@AtollService({ pool })` class-level and `@AtollTask` method-level offload —
  bodies run inside the worker's own Nest context on DI-resolved providers;
  `runAtollWorker(AppModule)` is the entire worker entrypoint; worker-side
  guard prevents nested pools when feature modules are shared between
  API and worker contexts.

### Packaging

- Per-module `dist` (not a monolith) — dependencies (`zod`, `msgpackr`,
  `@msgpack/msgpack`, `solid-js`) are external so bundlers tree-shake unused
  parts; deep imports reach the TypeScript sources via the `./*` export.
- `workerBootstrap` is marked side-effectful so bundlers keep its
  `self.onmessage` wiring.
- Releases stage to npm (`npm stage publish`) for maintainer-approved,
  provenance-attested publishing — OIDC trusted publishing supported
  (`npm trust github … --allow-stage-publish`), so the workflow can run
  secretless and stage-only.

### Requirements & caveats

- Browser `Worker` (or `node:worker_threads`); `SharedArrayBuffer` +
  `crossOriginIsolated` only when `sharedMemory` is used (islands run
  headerless in `poll` mode).
- Safari lacks `SharedWorker` — feature-detect before `connectSharedWorker`.
- Bindings ship TypeScript source; your bundler compiles them. Works with
  TypeScript 6 and 7.
- Single-writer field semantics — multi-writer coordination is on you
  (`Atomics.compareExchange` or a designated writer).

### Ecosystem in the box

- Consumer docs + live demos at `jwhenry3.github.io/atolljs/consumer/` —
  a `coi-sw.js` service worker injects COOP/COEP on headerless hosts so the
  demos run in `push` mode, with automatic `poll` fallback; in-repo agent/
  developer docs live under `docs/`.
- Runnable examples for all six frameworks + NestJS + Node, an `incidents`
  domain package as the reference integration, and a worker-DOM islands demo
  (React + Vue + imperative islands in one page).
- 66 test files / 478 tests including a real `nest build` → boot → HTTP e2e.
