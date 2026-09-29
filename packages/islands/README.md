# @atolljs/islands

Framework islands inside Atoll workers — opt-in DOM rendering off the main
thread. A real framework renderer commits against a DOM-free host surface in
the worker; every commit serializes to an op stream the main thread replays as
DOM mutations.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)**

The vocabulary:

- **PolyWorker** — one worker hosting a REGISTRY of islands
  (`definePolyWorker({ apps })`). Several islands share one module graph, one
  framework runtime, one op pump — the bundle-optimization shape.
- **MonoWorker** — one worker pinned to a single island app
  (`defineMonoWorker(app)`). Own bundle, own failure domain — the isolation
  shape.
- **Island** — one mounted instance of a registered app. Each gets a `app@N`
  **instance key** that scopes its op queue, document, and events.

## Install

```bash
npm install @atolljs/core @atolljs/islands          # framework-neutral core
npm install @atolljs/react-island                   # + a shell binding for your framework
```

Shell bindings (main-thread components + per-framework worker renderers):
[`@atolljs/react-island`](../react-island),
[`@atolljs/vue-island`](../vue-island),
[`@atolljs/svelte-island`](../svelte-island),
[`@atolljs/solid-island`](../solid-island),
[`@atolljs/angular-island`](../angular-island).
A registry worker can mix apps from several frameworks — plus imperative
proxy-DOM apps — freely.

## Quickstart

```ts
// render.worker.ts — the whole worker entry
import { definePolyWorker } from '@atolljs/islands/worker';
import { reactIslandApp } from '@atolljs/react-island/worker';

export const renderWorker = definePolyWorker({
  apps: {
    dashboard: reactIslandApp(DashboardApp),          // a React component
    vanilla: { imperative: (doc, props) => { ... } } // or pure proxy-DOM code
  },
});
```

```ts
// main thread — one call: `worker` builds an island-owned client internally
import { mountIsland } from '@atolljs/islands';

const island = await mountIsland({
  worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
  el: document.getElementById('island')!,
  app: 'dashboard',
  props: { ... },
  onEvent: (name, payload) => { ... },        // island → shell emit() channel
  slots: { preview: (el) => mountCanvas(el) }, // transclusion holes
});
island.updateProps({ ... });
island.destroy();
```

Pass `client: connectIslandWorker({ worker })` instead of `worker` when
several islands should share one worker (the client is released when its last
island destroys). Framework apps ship via the `*-island` packages — each
re-exports `definePolyWorker`/`emit` so the worker entry needs no direct
islands import:

```ts
import { defineVuePolyWorker } from '@atolljs/vue-island/worker';
export const worker = defineVuePolyWorker({ apps: { counter: Counter } });
// also: defineReactPolyWorker, defineSveltePolyWorker,
//       defineSolidPolyWorker, defineAngularPolyWorker
```

Stamp apps with `islandApp(name, app)` so a shell-side component reference
resolves to its registry key — the stamp is a data property, minification-proof
(unlike `fn.name`).

## Worker entries per bundler

The `worker` option is a factory — the bundler must see the worker script as
an entry:

- **Vite / webpack 5**: `() => new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` — the `new URL` literal is what the bundler detects; don't hoist or compute it.
- **Vite alternative**: `import XWorker from './x.worker.ts?worker'` then `worker: () => new XWorker()`.
- **esbuild / others**: the URL pattern needs the bundler's worker handling; otherwise compile the worker entry separately and pass a resolved URL.

A path the bundler didn't resolve surfaces as a `mountIsland` `mountTimeout`
rejection naming the unanswered entry — not a silent hang.

## Island rules

- **Pool size is pinned to 1.** One tree lives in one worker's memory — scale
  out with more islands, not wider pools.
- **Instance keys** are `app` or `app@N`; `mountIsland` mints them and the
  same app can mount in many islands at once.
- **Clients can be shared.** Several `mountIsland`s into one
  `connectIslandWorker` co-locate their instances in one worker; `destroy()`
  unmounts just that instance and the worker terminates when its last island
  leaves.
- **Async commits flush themselves.** Push mode (the default) subscribes the
  shared-memory doorbell — `useEffect` commits, timers, and scheduler
  post-task work arrive with no ritual. `mountIsland({ mode: 'poll' })` needs
  no `SharedArrayBuffer`, so no COOP/COEP cross-origin isolation.
- **`emit(name, payload)`** is the island→shell channel;
  **`callbackProp(fn)`** is the shell→worker half — pass it in props and the
  worker receives a callable (fire-and-forget).
- **Slots** — a worker-side `<Slot name="x"/>` (React islands:
  `@atolljs/react-island/worker`) renders a `data-atoll-slot` leaf the shell
  fills with real main-thread DOM.
- **The proxy DOM is write-path-plus-container-geometry.** Shadow-tree reads
  work; only the island container is measured (pushed via `ResizeObserver`).
  Everything else returns honest 0/empty.
- **Worker-initiated DOM work outside a task** must re-enter via
  `runInInstance(instance, fn)` + `bumpOpsVersion()` — ambient
  `document`/`window` resolution is a heuristic, not a contract.
- **`preventDefault` can never work** — the real event already dispatched on
  the main thread. Keep high-frequency input (`pointermove`, per-keystroke)
  on the main thread; slots exist for exactly this.

## Testing islands in-process

`@atolljs/core/testing/inProcessWorker` ships a `Worker` test double that runs
the whole protocol in-process — real task registry, real op stream, real
shared-memory binding; only the thread boundary is faked:

```ts
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./my.worker')];

const island = await mountIsland({ worker: () => new Worker(url, { type: 'module' }), ... });
```

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)
- [Worker islands](https://jwhenry3.github.io/atolljs/consumer/#/islands) —
  mountIsland options, `IslandHandle`, transport modes
- [Writing island apps](https://jwhenry3.github.io/atolljs/consumer/#/island-apps) —
  emit/callbackProp/slots, instance discipline
- In-repo internals: [`docs/islands.md`](../../docs/islands.md),
  [`docs/islands-worker.md`](../../docs/islands-worker.md),
  [`docs/islands-frameworks.md`](../../docs/islands-frameworks.md) — proxy-DOM
  surface, worker renderers, bundle composition, real-library limits

`@atolljs/islands` itself is framework-free — `react`/`react-reconciler` are
peer deps of `@atolljs/react-island` only (its `/worker` entry is the React
renderer), so imperative-only and non-React consumers install zero React.
