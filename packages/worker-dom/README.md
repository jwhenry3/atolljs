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
  or commit-phase effects while a task holds the realm.
- **Slots** — `<Slot name="x"/>` renders a leaf `data-mesh-slot` element whose
  contents the shell fills with real main-thread DOM.
- **The proxy DOM is write-path-only.** Shadow-tree reads work (children,
  querySelector, innerHTML); geometry does not (`getBoundingClientRect`,
  `offsetWidth`, `getComputedStyle` → 0/empty, warn once).
- **`installDomShim(doc)`** puts the proxy doc on `globalThis.document` plus a
  `window` facade — `innerHTML` parses via htmlparser2, `document`/`window`
  listeners land on the island container (id 0) so delegation works, and
  `payload.target` resolves to the proxy node. `globalThis.addEventListener`
  and `self` are never touched — the pool's message channel lives there.
  `uninstall()` (or `doc.dispose()`) restores the globals.

Peer deps `react`/`react-reconciler` are required even for imperative-only
consumers — the package *is* the React-rendering pattern; tree-shaking drops
the reconciler if you never call `defineIslandWorker` with React apps.
