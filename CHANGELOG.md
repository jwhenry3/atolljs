# Changelog

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
| `@atolljs/solid-island` | `<AtollIsland/>`, `solidIsland` |
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
