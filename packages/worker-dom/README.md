# @jwhenry123/mesh-worker-dom

Worker-side React reconciler + proxy-DOM islands for `@jwhenry123/mesh` — opt-in
DOM rendering inside workers. A real `react-reconciler@0.34` runs in the worker
against a DOM-free host config; every commit serializes to an op stream that the
main thread replays as DOM mutations. Imperative (non-React) apps get a proxy
`document` whose mutations emit the same ops — plus `installDomShim(doc)`, which
sets `globalThis.document`/`window` so real DOM-dependent libraries run
unmodified inside a realm.

## Quickstart

```ts
// render.worker.ts — the whole worker entry
import { defineIslandWorker } from '@jwhenry123/mesh-worker-dom/worker';

export const renderWorker = defineIslandWorker({
  apps: {
    dashboard: DashboardApp,                        // a React component
    vanilla: { imperative: (doc, props) => { ... } } // or pure proxy-DOM code
  },
});
```

```ts
// main thread
import { connectIslandWorker, mountIsland } from '@jwhenry123/mesh-worker-dom';

const island = await mountIsland({
  client: connectIslandWorker({
    worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
  }),
  el: document.getElementById('island')!,
  app: 'dashboard',
  props: { ... },
  onEvent: (name, payload) => { ... },        // island → shell emit() channel
  slots: { preview: (el) => mountCanvas(el) }, // transclusion holes
});
island.updateProps({ ... });
island.destroy();
```

## Island rules

- **poolSize is pinned to 1.** One tree lives in one worker's memory —
  scale out with more islands (`connectIslandWorker` per island), not wider pools.
- **Realm keys** are `app` or `app@N`; `mountIsland` mints them, the same app
  can mount in many islands at once, and `mount`/`updateProps`/`dispatch`/
  `flush`/`whoami` all take the realm first.
- **`emit(name, payload)`** is the island→shell channel — call inside handlers
  or commit-phase effects while a task holds the realm. From a library
  callback that fires on a timer or promise (no realm active), wrap it:
  `runInRealm(realm, () => { emit(...); bumpOpsVersion(); })` — Leaflet's
  `zoomend` in the demo does exactly this.
- **Slots** — `<Slot name="x"/>` renders a leaf `data-mesh-slot` element whose
  contents the shell fills with real main-thread DOM.
- **The proxy DOM is write-path-plus-container-geometry.** Shadow-tree reads
  work (children, querySelector, innerHTML); so does ONE measured box — the
  driver's `ResizeObserver` pushes the island container's size into the realm
  (`setSize`), and `doc.body`/`documentElement`/elements marked
  `doc.markContainer(el)` report it from `clientWidth`/`offsetWidth`/
  `getBoundingClientRect`. Everything else returns honest 0/empty and warns
  once. `doc.onResize(cb)` re-fires on each push (Leaflet uses it for
  `map.invalidateSize()`).
- **Event payloads are spec-shaped for pointer events.** clientX/Y, screenX/Y,
  button, `which` (button+1), modifiers, wheel deltaX/Y/deltaMode, pointerType,
  scrollTop, and `targetId` (resolved to a proxy node as `payload.target`) all
  cross. Pointer-family events always carry *numeric* coords — absent fields
  normalize to 0 rather than leaking `undefined` into library math.
- **`installDomShim(doc)`** puts the proxy doc on `globalThis.document` plus a
  `window` facade — `innerHTML` parses via htmlparser2, `document`/`window`
  listeners land on the island container (id 0) so delegation works,
  `window.innerWidth/innerHeight` reflect the pushed size, and
  `globalThis.Element` becomes `ProxyElement` for `instanceof` checks.
  `globalThis.addEventListener` and `self` are never touched — the pool's
  message channel lives there. `uninstall()` (or `doc.dispose()`) restores the
  globals.

## Real libraries — what works

The `map` island in `examples/react-dom-worker` runs **Leaflet 1.9, unmodified
from npm**, entirely worker-side: `installDomShim(doc)` then
`await import('leaflet')` (dynamic import is required — Leaflet reads
`document`/`window` at module scope for Browser detection). Verified working:
tile `<img>` ops, divIcon markers, controls, attribution, drag-pan
(document-level listeners registered mid-gesture), wheel zoom, delegated
marker clicks, and `doc.onResize` → `invalidateSize()`.

Known limits for DOM-heavy libraries:

- **Geometry is one box.** Only the island container is measured (pushed);
  libraries that measure arbitrary elements still get 0.
- **`preventDefault`/`stopPropagation` are no-ops** — the real event already
  dispatched on the main thread; the worker can't cancel it.
- **Async-library callbacks that mutate DOM or emit outside a task** must
  re-enter via `runInRealm(realm, fn)` — timers and promise continuations
  have no active realm.
- **`getContext('2d'/'webgl')` is out of scope** for the op protocol —
  canvas-based libraries belong on `OffscreenCanvas`, which is a different
  transport.

Peer deps `react`/`react-reconciler` are required even for imperative-only
consumers — the package *is* the React-rendering pattern; tree-shaking drops
the reconciler if you never call `defineIslandWorker` with React apps.
