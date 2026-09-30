# Worker islands

Read when: working on `packages/islands/` (the engine, driver, op protocol),
`mountIsland`/`connectIslandWorker`, or any island mount site.

`@atolljs/islands` renders framework trees *inside* Atoll workers: the
worker owns the render loop and every commit serializes to an op stream the
main thread replays as real DOM mutations. Opt-in DOM rendering off the main
thread — the shell keeps events, layout, and slots; the worker keeps the app.
Source: `packages/islands/src/island.ts` (driver), `src/ops.ts` (protocol),
`src/worker/` (worker side).

## Vocabulary

| Term | Meaning |
|---|---|
| **Atoll** | The fabric — worker pools, contracts, shared memory, task dispatch (`@atolljs/core`). Islands are one workload built on it. |
| **PolyWorker** | `definePolyWorker({ apps })` — one worker hosting a *registry* of islands. The bundle-optimization shape: several islands share one module graph, one framework runtime, one op pump. |
| **MonoWorker** | `defineMonoWorker(app)` — one worker pinned to a single app. The isolation shape: own bundle, own failure domain, nothing reachable outside it. |
| **Island** | The mounted unit — `mountIsland()` puts one instance of a registered app into a container element. Each mount mints an `app@N` **instance key** that scopes its op queue, proxy document, and events. |
| **Shell** | The main-thread side — plain DOM, or any framework via the `*-island` packages. |

## How it fits together

```
┌───────────────────────────── main thread ─────────────────────────────┐
│  mountIsland driver: replays op batches onto real DOM in `el`,        │
│  dispatches real events back, pushes container size via ResizeObserver │
└──────────────┬─────────────────────────────────▲──────────────────────┘
   EXECUTE_TASK │ postMessage          op batches │ (task results) + flush
   (mount/update│                      emits     │
    Props/dispatch/flush/unmount)                │ doorbell: SharedArrayBuffer
┌──────────────▼─────────────────────────────────┴──────────────────────┐
│  worker: definePolyWorker({ apps }) / defineMonoWorker(app)           │
│  per instance: reconciler or proxy-DOM app → mutations serialize to ops│
└───────────────────────────────────────────────────────────────────────┘
```

Inside the worker, a real `react-reconciler@0.34` (React islands) or the
per-framework renderer (Vue/Svelte/Solid/Angular islands) commits against a
DOM-free host surface; every commit serializes to an op stream. Imperative
(non-framework) apps get a proxy `document` whose mutations emit the same ops.
Events work the other direction: a worker-side `addEventListener` becomes a
`listen` op, the driver attaches a real listener, and each dispatch
round-trips back to the worker as an instance-scoped task.

The shared-memory contract here is only a *doorbell* — a commit counter the
main thread `observe()`s to trigger `flush()` as a push. Ops themselves always
ride the pool's ordinary postMessage channel. Drop the doorbell entirely and
islands still work on the 50ms poll — that's the message-only mode, no
`SharedArrayBuffer` and no COOP/COEP requirement.

## Quickstart

```ts
// render.worker.ts — the whole worker entry
import { definePolyWorker } from '@atolljs/islands/worker';
import { reactIslandApp } from '@atolljs/react-island/worker';

export const renderWorker = definePolyWorker({
  apps: {
    dashboard: reactIslandApp(DashboardApp),          // a React component
    vanilla: { imperative: (doc, props) => { ... } }, // or pure proxy-DOM code
  },
});
```

Framework apps enter the registry wrapped — `reactIslandApp`,
`vueIslandApp`, … adapt a component to the worker's `RenderedIslandApp`
contract. Single-framework registries skip the wrap: each `*-island` package
ships `define*PolyWorker`/`define*MonoWorker` helpers that take plain
components (`defineReactPolyWorker({ apps: { dashboard: DashboardApp } })`).

```ts
// main thread — one call; `worker` builds an island-owned client internally
import { mountIsland } from '@atolljs/islands';

const island = await mountIsland({
  worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
  el: document.getElementById('island')!,
  app: 'dashboard',
  props: { ... },
  onEvent: (name, payload) => { ... },         // island → shell emit() channel
  slots: { preview: (el) => mountCanvas(el) }, // transclusion holes
});
island.updateProps({ ... });
island.destroy();
```

Pass `client: connectIslandWorker({ worker })` instead of `worker` when
several islands should share one worker — multi-island-per-worker. The client
is released when its last island destroys.

## `mountIsland` options

| Option | Notes |
|---|---|
| `el` | Container element the op stream replays into. Required. |
| `worker` / `client` | Exactly one: a bundler-detectable worker factory (or URL) this mount owns, or a shared `connectIslandWorker` client. |
| `app` | Registry key into `apps`. Optional for MonoWorkers — a single-registered-app worker resolves its sole app regardless of the requested name. |
| `props` | Serialized to the worker via `structuredClone` — uncloneable values reject naming the offending key. `callbackProp(fn)` markers pass shell functions through. |
| `onEvent` | Receives every worker-side `emit(name, payload)`. |
| `slots` | `{ name: (el \| null) => void }` — when a `data-atoll-slot` element's create op lands, the real element is handed here; called again with `null` on removal/rename. The element stays worker-owned; its contents are yours. |
| `onActivity` | Fired after each applied op batch — stats/keepalive hook. |
| `onOps` | `(ops, elapsedMs)` after each replay — pair with client timing to split worker-vs-main cost before committing a workload to an island. |
| `mode` | `'push'` (default — SAB doorbell) or `'poll'` (50ms drain). With the `worker` shorthand, `'poll'` also builds a doorbell-free client — no SharedArrayBuffer, no isolation headers. |
| `mountTimeout` | Bounds the mount handshake — default 15s, `0` disables. A worker entry that loads but never answers rejects with a named error instead of pending forever; hard failures reject immediately. A failed mount releases the instance and terminates an island-owned client. |

Driver-side prop application follows DOM conventions: `class`/`className`
write the property, `onX` refs become real listeners, and `style` objects
merge key-by-key with React-DOM unit semantics — numbers on non-unitless
properties gain a `px` suffix (`style={{ height: 24000000 }}` works;
unitless keys like `opacity`/`zIndex` pass through verbatim), custom
properties and kebab-case keys go through `setProperty`.

## `IslandHandle`

| Member | Notes |
|---|---|
| `app` / `pid` | The registry name, and the instance's random worker-side id — proof each island is a distinct render instance (stable across remounts). |
| `updateProps(props)` | Shell→island channel — re-renders the root with new serialized props. Framework renderers patch fine-grained; imperative apps rebuild (dispose + clear + re-mount on a fresh document). |
| `setMode(mode)` | Switch push↔poll after mount. Doorbell rebinds re-watch transparently. |
| `flush()` | Manual drain of ops committed outside task calls — poll mode's mechanism, rarely needed under push. |
| `destroy()` | Releases the instance via `unmount`; terminates the worker when this island owns the client, leaves siblings running when it's shared. |
| `opsApplied` / `flushCalls` | Replay counters — the demo's aggregate stats read these. |

## Two worker topologies

**Registry workers** (`definePolyWorker`) serve a whole apps map from one
script — islands mount by name, and several mounts can share ONE client so
their instances co-locate in a single worker (separate reconcilers, op queues,
and pids — one OS thread). **Instance workers** (`defineMonoWorker`) are the
1:1 form — one script per app, mounted namelessly, bundling only that app's
dependencies.

References: `examples/react-dom-worker/src/worker/react.worker.tsx`
(React registry — counter/notes/incidents), `…/render.worker.ts`
(the seven-island showcase registry), `…/vanilla.worker.ts`,
`…/map.worker.ts` (mono), `…/vue.worker.ts` (Vue island).

Pool discipline: `connectIslandWorker` pins `poolSize: 1` — one tree lives in
one worker's memory, so scale out with more islands, not wider pools.
Everything else in `connectWorker` config (`concurrency`, `taskTimeout`,
`respawn`, `lazy`…) passes through, plus one islands-only option:
`doorbell: false` skips the shared-memory contract entirely — the pool
constructor throws on `sharedMemory` without `SharedArrayBuffer`, so this is
*required* on non-isolated pages (poll transport then covers flushes;
`setMode('push')` on such a client just polls). The `worker:`-shorthand form
of `mountIsland` does this implicitly when `mode: 'poll'` is passed.

## Worker entries per bundler

The `worker` option is a factory — the bundler must see the worker script as
an entry, which is where setups diverge:

- **Vite / webpack 5**: `() => new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` — the `new URL` literal is what the bundler detects; don't hoist or compute it.
- **Vite alternative**: `import XWorker from './x.worker.ts?worker'` then `worker: () => new XWorker()`.
- **esbuild / others**: the URL pattern needs the bundler's worker handling (esbuild bundles it only in `format: 'esm'` builds); otherwise compile the worker entry separately and pass a resolved URL.

A path the bundler didn't resolve shows up as a `mountIsland` `mountTimeout`
rejection naming the unanswered entry — not a silent hang.

## Shell packages

`@atolljs/islands` itself is framework-free on the shell side — `mountIsland`
takes a plain element. When the shell is a framework app, the companion
`*-island` packages wrap the same calls idiomatically: `<Island/>`/
`lazyIsland` for [React](frameworks/react.md), `useIsland`/`<AtollIsland>` for
[Vue](frameworks/vue.md), the `use:island` action for
[Svelte](frameworks/svelte.md), `createIsland`/`Island` for
[Solid](frameworks/solid.md), and `<atoll-island>`/`[atollIsland]` for
[Angular](frameworks/angular.md). The same packages also carry the worker
renderers — see [islands-frameworks.md](islands-frameworks.md).
