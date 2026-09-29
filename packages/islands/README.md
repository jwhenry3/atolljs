# @jwhenry123/mesh-islands

Framework islands inside Mesh workers — opt-in DOM rendering off the main
thread. The vocabulary:

- **Mesh** — the fabric: worker pools, contracts, shared memory, task dispatch
  (`@jwhenry123/mesh`).
- **PolyWorker** — one worker hosting a REGISTRY of islands
  (`definePolyWorker({ apps })`). The bundle-optimization shape: several
  islands share one module graph, one framework runtime, one op pump.
- **MonoWorker** — one worker pinned to a single island app
  (`defineMonoWorker(app)`). The isolation shape: own bundle, own failure
  domain, nothing reachable outside it.
- **Island** — the framework pillar and the mounted unit: `*-island` packages
  are the per-framework worker renderers; `mountIsland()` mounts one instance
  of a registered app. Each mounted instance gets a `app@N` **instance key**
  that scopes its op queue, document, and events.

Inside the worker, a real `react-reconciler@0.34` (React islands) or the
per-framework renderer (Vue/Svelte/Solid/Angular islands) commits against a
DOM-free host surface; every commit serializes to an op stream the main
thread replays as DOM mutations. Imperative (non-framework) apps get a proxy
`document` whose mutations emit the same ops — plus `installDomShim(doc)`,
which sets `globalThis.document`/`window` so real DOM-dependent libraries
run unmodified inside an instance.

## Quickstart

```ts
// render.worker.ts — the whole worker entry
import { definePolyWorker } from '@jwhenry123/mesh-islands/worker';

export const renderWorker = definePolyWorker({
  apps: {
    dashboard: DashboardApp,                        // a React component
    vanilla: { imperative: (doc, props) => { ... } } // or pure proxy-DOM code
  },
});
```

```ts
// main thread — one call: `worker` builds an island-owned client internally
import { mountIsland } from '@jwhenry123/mesh-islands';

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
several islands should share one worker (multi-island-per-worker — the
client is released when its last island destroys).

## Worker entries per bundler

The `worker` option is a factory — the bundler must see the worker script as
an entry, which is where setups diverge:

- **Vite / webpack 5**: `() => new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` — the `new URL` literal is what the bundler detects; don't hoist or compute it.
- **Vite alternative**: `import XWorker from './x.worker.ts?worker'` then `worker: () => new XWorker()`.
- **esbuild / others**: the URL pattern needs the bundler's worker handling (esbuild bundles it only in `format: 'esm'` builds); otherwise compile the worker entry separately and pass `worker: new URL('/assets/x.worker.js', import.meta.url)`-style resolved URLs.

A path the bundler didn't resolve shows up as a `mountIsland` `mountTimeout`
rejection naming the unanswered entry — not a silent hang.

## React shells: `@jwhenry123/mesh-react-island`

When the *shell* itself is a React app, the companion package
[`@jwhenry123/mesh-react-island`](../react-island) wraps these calls in
components — `<Island/>` for the declarative `mountIsland`, and the
`islandComponent`/`lazyIsland` proxies that make a worker app look and type
like a local component (Suspense on the module load, `fallback` prop on the
mount). This package stays React-free on the shell side by design — the
component layer lives there.

App contracts still live here: `islandApp(name, app)` stamps an app with its
registry name (a data property — minification-proof, unlike `fn.name`) so a
shell-side component reference resolves to the wire key, and
`definePolyWorker` warns if a stamp and its registry key drift apart.
`IslandAppProps<A>` infers a reference's props type from its signature.

## Framework worker renderers

The third app kind: `RenderedIslandApp` — `{ mount({instance, doc, props}) →
{ update?, dispose? } }`. The app renders into the instance's proxy document
with its own native renderer; every mutation emits the same op stream, and
`update`/`dispose` give the framework fine-grained `updateProps` and clean
teardown instead of the imperative clear-and-rebuild. Framework bindings
ship as `*-island` packages — each re-exports `definePolyWorker`/`emit`
so the worker entry needs no direct islands import:

```ts
// vue:  import { defineVuePolyWorker }  from '@jwhenry123/mesh-vue-island/worker'
// svelte: import { defineSveltePolyWorker } from '@jwhenry123/mesh-svelte-island/worker'
// solid: import { defineSolidPolyWorker }  from '@jwhenry123/mesh-solid-island/worker'
// angular: import { defineAngularPolyWorker } from '@jwhenry123/mesh-angular-island/worker'
export const worker = defineVuePolyWorker({ apps: { counter: Counter } });
```

| Package | Worker renderer | updateProps | Notes |
|---|---|---|---|
| `mesh-vue-island` | Vue `createRenderer` → proxy DOM | fine-grained (`cloneVNode` + `render`) | `.once`/`.passive`/`.capture` modifiers ride the wire; out-of-task commits arrive on `flush()`/doorbell |
| `mesh-svelte-island` | Svelte 5 `mount()` into `doc.body`, `$state` props box | fine-grained | Compiled components only (vite-plugin-svelte); `emit`/`runInInstance` re-exported |
| `mesh-solid-island` | `solid-js/universal` `createRenderer` | fine-grained (per-key signal props) | **Pin the client build** — `worker`/`node` resolve conditions pick the SSR build; the adapter probes and throws if it happens anyway. JSX needs `babel-preset-solid` `{generate:'universal'}` (see its README) |
| `mesh-angular-island` | `RendererFactory2`/`Renderer2` → proxy DOM + `createComponent`, zoneless | `setInput` + manual CD | JIT components need `import '@angular/compiler'` in the worker entry (missing it throws a named error); AOT/`ɵcmp` components need nothing |

All four speak the same protocol — a registry worker can mix React,
Vue, Svelte, Solid, Angular, and imperative apps freely.

## Bundle composition — what's in a worker bundle

The `/worker` entry is framework-neutral: `definePolyWorker`, the proxy
DOM, the op protocol, event dispatch, `emit`/`callbackProp`, and instance
lifecycle. Framework runtimes arrive only through the binding you import:

- **React islands** — `react` + `react-reconciler` + the host config live in
  `worker/reactInstance.ts`, reached via `await import()` the first time a
  registered app resolves to a React component. A worker whose registry
  holds only Vue/Svelte/Solid/Angular/imperative apps never loads it —
  bundlers put it in a lazily-fetched chunk (or drop it entirely when the
  worker entry can't reach it statically).
- **Vue/Svelte/Solid/Angular islands** — each `-island` package statically
  imports only its own framework. A `defineVuePolyWorker` entry bundles
  islands core + Vue, and no other framework.
- **Imperative-only** — islands core alone (plus `htmlparser2`, which
  the proxy DOM's `innerHTML`/`insertStaticContent` need).

Two caveats: the `Slot` helper is a React component (its JSX pulls in
`react/jsx-runtime` — a few KB, tree-shaken when unused), and
`definePolyWorker`'s mount task is `async` because a React first-mount
awaits the runtime chunk — callers already `await` it, so this is only a
typing-level detail.

## Writing a worker renderer

A renderer adapter is a `RenderedIslandApp` — one method:

```ts
interface RenderedIslandApp {
  mount(ctx: { instance: string; doc: ProxyDocument; props: Record<string, unknown> }):
    { update?(props): void; dispose?(): void } | void;
}
```

`mount` runs inside the instance's scope; everything the framework writes into
`ctx.doc` serializes to the op stream. The proxy-DOM surface a renderer can
rely on: `createElement`/`createElementNS`/`createTextNode`/`createComment`,
`insertBefore`/`appendChild`/`removeChild` (fragments splice their children
in), `setAttribute`/`setAttributeNS`, `textContent`, `innerHTML`,
`cloneNode`, `template.content`, and `addEventListener` (`{once, passive,
capture}` options cross the wire). Comments are real anchors — frameworks
placing branch markers (Vue `v-if`, Svelte `{#if}`) should use
`doc.createComment`, not empty text nodes.

Instance discipline: `mount` itself is instance-scoped, but framework schedulers
that flush *after* the task (Vue's microtask queue, Svelte's tick) have no
active instance — resolve via `getActiveInstance() || getLastActiveInstance()` and
prefer the captured `ctx.instance`/`ctx.doc` over ambient lookup. Work the
renderer kicks off from timers or promise continuations must re-enter with
`runInInstance(instance, fn)` — with several islands on one shared client the
last-active fallback can resolve the *sibling* instance, so treat ambient
resolution as a convenience, not a contract. After mutations made outside a
dispatch task, `bumpOpsVersion()` rings the push-mode doorbell so the
driver flushes the queued ops.

`update(props)` receives the newly serialized props — patch fine-grained.
Omit it and `updateProps` degrades to imperative semantics (dispose +
fresh document + remount). `dispose()` runs inside the instance before its
proxy document is torn down — unmount framework roots, stop effects.

Events: worker-side `addEventListener` becomes a `listen` op; a dispatch
round-trips back as a instance-scoped task whose payload carries `target`/
`currentTarget` as proxy nodes and stamps `e.target.value`/`checked`.
`preventDefault` can never work — the real event already dispatched on the
main thread — so renderers should not promise it.

## Testing islands in-process

`@jwhenry123/mesh/sdk/testing/inProcessWorker` ships a `Worker` test double
that runs the whole protocol in-process — real task registry, real op
stream, real shared-memory binding; only the thread boundary is faked:

```ts
import { InProcessWorker } from '@jwhenry123/mesh/sdk/testing/inProcessWorker';
vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./my.worker')];

const island = await mountIsland({ worker: () => new Worker(url, { type: 'module' }), ... });
```

Entry modules load lazily on first pool init (like a real worker script —
and even for doorbell-free, message-only pools); a module that throws fires
an `error` event and the worker drops subsequent tasks, so mount failures
reject instead of hanging. `InProcessWorker.created` tracks spawned
instances; `flushObservers()` settles microtasks + the shared-memory
observer loop.

## Island rules

- **poolSize is pinned to 1.** One tree lives in one worker's memory —
  scale out with more islands (`connectIslandWorker` per island), not wider pools.
- **Two worker entries.** `definePolyWorker({ apps })` is a registry —
  one script serves many named apps. `defineMonoWorker(app)` is the 1:1
  form — one script, one app, bundled with only that app's dependencies and
  mounted namelessly (`mountIsland({ client, el })`, no `app`). A
  single-registered-app worker resolves its sole app regardless of the
  requested name.
- **Instance keys** are `app` or `app@N`; `mountIsland` mints them, the same app
  can mount in many islands at once, and `mount`/`updateProps`/`dispatch`/
  `flush`/`unmount`/`whoami` all take the instance first.
- **Clients can be shared.** Several `mountIsland`s into ONE
  `connectIslandWorker` co-locate their instances in one worker (multi-island-
  per-worker). `destroy()` unmounts just that instance via `unmount`; the
  worker terminates when its last island leaves.
- **Async commits flush themselves.** Push mode (the default) subscribes the
  shared-memory doorbell when the mount handshake lands — `useEffect` commits,
  timers, and framework schedulers' post-task work arrive with no
  `setMode`/`flush` ritual. `mountIsland({ mode: 'poll' })` drains on a 50ms
  interval instead, and with the `worker` shorthand builds a doorbell-free
  client — no SharedArrayBuffer, so no COOP/COEP cross-origin isolation
  (`connectIslandWorker({ doorbell: false })` does the same for shared
  clients). `handle.setMode` still switches modes after mount.
- **`mountTimeout`** (default 15s, `0` disables) bounds the mount handshake —
  a worker entry that loads but never answers rejects with a named error
  instead of pending forever; hard failures (module-load errors, crashes)
  reject immediately regardless. A failed mount releases the instance and
  terminates an island-owned client.
- **`e.target.value` / `e.target.checked` work in handlers** — the dispatched
  form state is stamped onto the proxy event target, so uncontrolled-input
  handlers read the DOM idiom naturally.
- **`emit(name, payload)`** is the island→shell channel — call inside handlers
  or commit-phase effects while a task holds the instance. From a library
  callback that fires on a timer or promise (no instance active), wrap it:
  `runInInstance(instance, () => { emit(...); bumpOpsVersion(); })` — Leaflet's
  `zoomend` in the demo does exactly this.
- **`callbackProp(fn)`** is the shell→worker half: pass it in props
  (`props: { onSave: callbackProp(fn) }`) and the worker receives a callable
  — invoking it fires `fn(...args)` on the shell, marshalled through the
  emit channel. Fire-and-forget: the callable returns `undefined` (there's
  no await channel), and calls made outside a dispatch task flush via the
  doorbell. Markers work nested inside prop objects/arrays too.
- **Slots** — `<Slot name="x"/>` renders a leaf `data-mesh-slot` element whose
  contents the shell fills with real main-thread DOM.
- **The proxy DOM is write-path-plus-container-geometry.** Shadow-tree reads
  work (children, querySelector, innerHTML); so does ONE measured box — the
  driver's `ResizeObserver` pushes the island container's size into the instance
  (`setSize`), and `doc.body`/`documentElement`/elements marked
  `doc.markContainer(el)` report it from `clientWidth`/`offsetWidth`/
  `getBoundingClientRect`. Everything else returns honest 0/empty and warns
  once. `doc.onResize(cb)` re-fires on each push (Leaflet uses it for
  `map.invalidateSize()`).
- **Event payloads are spec-shaped for pointer events.** clientX/Y, screenX/Y,
  button, `which` (button+1), modifiers, wheel deltaX/Y/deltaMode, pointerType,
  scrollTop, and `targetId` (resolved to a proxy node as `payload.target`) all
  cross. Pointer-family events always carry *numeric* coords — absent fields
  normalize to 0 rather than leaking `undefined` into library math. At dispatch
  time `target`/`currentTarget` materialize as proxy nodes (`currentTarget` =
  the node the handler was attached to, the instance root for id-0 listeners) so
  library middleware can read them — geometry still returns honest zeros.
- **`installDomShim(doc)`** puts the proxy doc on `globalThis.document` plus a
  `window` facade — `innerHTML` parses via htmlparser2, `document`/`window`
  listeners land on the island container (id 0) so delegation works,
  `window.innerWidth/innerHeight` reflect the pushed size, and
  `globalThis.Element` becomes `ProxyElement` for `instanceof` checks.
  `globalThis.addEventListener` and `self` are never touched — the pool's
  message channel lives there. `uninstall()` (or `doc.dispose()`) restores the
  globals.
- **Instance-aware globals.** `definePolyWorker` installs a dispatcher so
  `document`/`window`/`Element` are *accessors*, not fixed globals: inside a
  instance task they resolve that instance's document (its facade, `ProxyElement`),
  outside tasks they resolve the sole or last-active instance's, and explicit
  assignments (`installDomShim`, test harnesses) take precedence over implicit
  resolution. React instances get a working `document`/`window` for free —
  libraries that read them during render or in deferred callbacks just work.
  On the main-thread driver, element checks are structural (`nodeType`), never
  `instanceof Element` — the same global may be a proxy in in-process setups.
  Last-active resolution is a heuristic: on a shared client whose islands run
  interleaved async work it can resolve the *sibling* instance — the contract
  for worker-initiated work is `runInInstance` (see "Writing a worker
  renderer").
- **SVG + portals + library refs.** Ops carry a namespace (`create` gets `ns`)
  and host context tracks `<svg>`/`<foreignObject>` boundaries — the driver
  uses `createElementNS`, so `<svg>` trees land correctly, including through
  portals (the container's namespace propagates). `getPublicInstance` exposes
  `ProxyElement` facades, which are valid react-dom `createPortal` containers —
  this is what makes recharts' tooltip/legend portals work unmodified.

## Real libraries — what works

**Imperative libraries.** The `map` island in `examples/react-dom-worker` runs
**Leaflet 1.9, unmodified from npm**, entirely worker-side: `installDomShim(doc)`
then `await import('leaflet')` (dynamic import is required — Leaflet reads
`document`/`window` at module scope for Browser detection). Verified working:
tile `<img>` ops, divIcon markers, controls, attribution, drag-pan
(document-level listeners registered mid-gesture), wheel zoom, delegated
marker clicks, and `doc.onResize` → `invalidateSize()`.

**React libraries.** The `charts` island runs **recharts 3.x, unmodified**, as
an ordinary React tree in the worker: `ComposedChart` with grid/axes/tooltip/
legend/bar/line, `onClick` handlers, and `emit` — verified end-to-end with a
bar-click round-trip. It exercises the general machinery above: namespaced
SVG ops, `ProxyElement` refs as portal targets (tooltip/legend render via
react-dom `createPortal`), instance-resolved `document`/`window` for its
selector/`getComputedStyle` calls, and `currentTarget` synthesis for its
mouse middleware. Use fixed chart dimensions — `ResponsiveContainer` has no
layout to observe — and prefer `isAnimationActive={false}` to skip
measurement-feedback render passes that converge but cost op volume.

Known limits for DOM-heavy libraries:

- **Geometry is one box.** Only the island container is measured (pushed);
  libraries that measure arbitrary elements still get 0 — SVG-specific reads
  (`getBBox`, `getTotalLength`, `getComputedTextLength`) too, which is why
  recharts text truncation/animation sizing degrades to stub values.
- **`preventDefault`/`stopPropagation` are no-ops** — the real event already
  dispatched on the main thread; the worker can't cancel it.
- **Async-library callbacks that mutate DOM or emit outside a task** must
  re-enter via `runInInstance(instance, fn)` — timers and promise continuations
  have no active instance.
- **`getContext('2d'/'webgl')` is out of scope** for the op protocol —
  canvas-based libraries belong on `OffscreenCanvas`, which is a different
  transport.

## Workload fit

Every event costs one postMessage round trip — `pointermove`, per-keystroke
input, and scroll handlers re-render on worker latency, and `preventDefault`
can't work because the real event already dispatched. Keep high-frequency
input on the main thread (slots exist for exactly this) and put coarse
interactions — clicks, toggles, form submits — behind the island. On the
other side of the ledger, main-thread replay scales with op *count*, not
tree size: fine-grained updates replay in ~1ms while whole-tree rebuilds
cost an order of magnitude more per frame. `mountIsland`'s `onOps` hook
reports the worker/main split if you want to measure a workload before
committing it to an island.

Peer deps `react`/`react-reconciler` are required even for imperative-only
consumers — the package *is* the React-rendering pattern; tree-shaking drops
the reconciler if you never call `definePolyWorker` with React apps.
