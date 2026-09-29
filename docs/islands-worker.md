# Inside the worker — island authoring surface

Read when: working on `packages/islands/src/worker/` — the proxy DOM,
instances, op emission, worker entry points — or writing island apps /
renderers.

The `/worker` entry of `@atolljs/islands` is what a worker bundle
imports (`src/worker/index.ts`): the two worker definers, the proxy DOM, the
op protocol, event dispatch, `emit`/`callbackProp`, and instance lifecycle —
framework-neutral by construction. `hostConfig` is deliberately NOT exported —
a static re-export would pull react + react-reconciler into every `/worker`
bundle; the reconciler is reachable only through `definePolyWorker`'s lazy
import of `reactInstance`.

## Three app kinds

`apps` values (or the `defineMonoWorker` argument) are one of three shapes.
React components are reconciled into the instance's own root;
`{ imperative }` apps get a proxy document and emit ops directly;
`RenderedIslandApp`s are the framework-adapter shape the `*-island` worker
packages produce.

```ts
// A PolyWorker registry mixes all three kinds freely — and any mix of
// frameworks, since each *-island adapter wraps its component into the
// RenderedIslandApp shape:
export const worker = definePolyWorker({
  apps: {
    dashboard: DashboardApp,                        // React component
    counter:   vueIslandApp(Counter),               // RenderedIslandApp (Vue)
    map:       { imperative: buildMap, dispose },   // imperative proxy-DOM
  },
});

// RenderedIslandApp — the contract every worker renderer satisfies:
interface RenderedIslandApp {
  mount(ctx: { instance: string; doc: ProxyDocument; props: Record<string, unknown> }):
    { update?(props): void; dispose?(): void } | void;
}
```

An imperative app's optional `dispose(doc)` — and a rendered handle's
`dispose()` — run inside the instance's scope *before* its proxy document is
torn down (unmount, remount, updateProps rebuild): cancel library timers,
animation loops, and listeners there so deferred work can't mutate a dead
instance.

`islandApp(name, app)` stamps an app with its registry name — a data
property, so the stamp survives minification (unlike `fn.name`). A shell-side
component reference then resolves to the wire key, and `definePolyWorker`
warns when a stamp and its registry key drift apart. `IslandAppProps<A>`
infers a reference's props type from its signature.

## The proxy document

Every instance owns a `ProxyDocument` (`src/worker/proxyDom.ts` →
`src/worker/dom/*`) — a DOM-free surface whose mutations serialize to ops.
What a renderer or imperative app can rely on:

- **Tree ops**: `createElement`/`createElementNS`/`createTextNode`/
  `createComment`, `insertBefore`/`appendChild`/`removeChild` (fragments splice
  their children in), `cloneNode` (kind-aware), `template.content`,
  `importNode`.
- **Attributes & content**: `setAttribute`/`setAttributeNS`, reflected-property
  accessors (`id`, `src`/`href`, `value`/`checked`, `tabIndex`…),
  `classList`/`style`/`dataset` proxies, `textContent`, `innerHTML`
  (htmlparser2, comment-preserving), CDATA sections.
- **Reads**: shadow-tree traversal — `children`,
  `querySelector`/`getElementsBy*`, `nodeName`/`namespaceURI`, the
  ChildNode/ParentNode conveniences (`before`/`after`/`remove`).
- **Comments are real anchors** — nodeType 8 over a real empty text node
  driver-side, so branch markers (Vue `v-if`, Svelte `{#if}`) keep a position.
  Frameworks should use `doc.createComment`, not empty text nodes.
- **Events**: `addEventListener` with `{ once, passive, capture }` — options
  cross the wire, `once` auto-detaches worker-side.

Coverage tests: `packages/islands/test/proxyDomSurface.test.ts`.

### Geometry — one honest box

The proxy DOM is write-path plus container geometry: a `ResizeObserver` on the
island container pushes its size into the instance, and
`doc.body`/`documentElement`/elements marked `doc.markContainer(el)` report it
from `clientWidth`/`offsetWidth`/`getBoundingClientRect`. Everything else
returns honest 0/empty and warns once. `doc.onResize(cb)` re-fires on each
push — Leaflet's `map.invalidateSize()` hooks it in the demo.

### `installDomShim(doc)` — running real libraries

Puts the proxy doc on `globalThis.document` plus a `window` facade —
`document`/`window` listeners land on the island container (id 0) so
delegation works, `window.innerWidth/innerHeight` reflect the pushed size,
timers/`matchMedia`/scroll are stubbed, and `globalThis.Element` becomes
`ProxyElement` for `instanceof` checks. `globalThis.addEventListener` and
`self` are never touched — the pool's message channel lives there.
`uninstall()` (or `doc.dispose()`) restores the globals.

For libraries that read `document`/`window` at module scope (Leaflet's Browser
detection), install the shim then `await import('leaflet')` — a static import
would evaluate against bare worker globals. Reference:
`examples/react-dom-worker/src/worker/map.ts`.

### Instance-aware globals

`definePolyWorker`/`defineMonoWorker` install a dispatcher
(`installInstanceDispatcher`) so `document`/`window`/`Element` — plus
`Node`/`Text`/`Comment` and stubs like `HTMLMediaElement`/`customElements` —
are *accessors*, not fixed globals: inside an instance task they resolve that
instance's document; outside tasks they resolve the sole or last-active
instance's; explicit assignments (like `installDomShim`) take precedence.
React instances get a working `document`/`window` for free — libraries that
read them during render or in deferred callbacks just work. On the main-thread
driver, element checks are structural (`nodeType`), never
`instanceof Element` — the same global may be a proxy in in-process setups.

## Instance discipline

`mount`/dispatch tasks run inside the instance's scope, but work a renderer or
library kicks off afterwards — timers, promise continuations, framework
microtask schedulers (Vue's queue, Svelte's tick) — has no active instance.
Resolve via `getActiveInstance() || getLastActiveInstance()` and prefer the
captured `ctx.instance`/`ctx.doc` over ambient lookup: on a shared client
whose islands run interleaved async work, last-active can resolve the
*sibling* instance — treat it as a convenience, not a contract. The contract
for worker-initiated work is `runInInstance(instance, fn)`, and after mutating
outside a dispatch task, `bumpOpsVersion()` rings the doorbell so the driver
flushes the queued ops.

## Channels — emit, callbackProp, slots

```ts
import { emit, runInInstance, bumpOpsVersion, getActiveInstance, Slot }
  from '@atolljs/islands/worker';
import { callbackProp } from '@atolljs/islands'; // shell side

// island → shell: lands in mountIsland's onEvent. Call inside a handler or
// commit-phase effect, while a task holds the instance.
emit('rowSelected', { id: row.id });

// shell → island: pass in props, the worker receives a callable.
//   shell:     props: { onSave: callbackProp((id) => save(id)) }
//   worker:    props.onSave(id) → fires fn(...args) on the shell.
// Fire-and-forget (no return channel); nested markers in prop objects work.
// Out-of-task callers still flush — the callable rings the doorbell itself.

// Library callbacks on timers/promises have no active instance — re-enter:
const instance = getActiveInstance()!;
map.on('zoomend', () =>
  runInInstance(instance, () => { emit('zoomChanged', { zoom: map.getZoom() }); bumpOpsVersion(); }));

// <Slot name="wave"/> — React helper rendering a leaf data-atoll-slot element
// whose contents the shell fills. Any renderer can emit the same leaf:
doc.createElement('div').setAttribute('data-atoll-slot', 'wave');
```

Mediation is unidirectional by convention: an island's `emit` lands in
`onEvent`, the shell sets state, and it flows back in as props — no hand-wired
`updateProps` calls. Slots are the escape hatch for content the worker can't
own (canvases, closed libraries like Google Maps JS): the worker owns the box,
the shell owns the contents — real DOM, real events, zero wire.

## Events dispatched in

A worker-side `addEventListener` emits a `listen` op; the driver attaches a
real listener and each dispatch posts back as an instance-scoped task. The
payload is spec-shaped for pointer-family events — clientX/Y, screenX/Y,
button, `which` (button+1), modifiers, wheel deltaX/Y/deltaMode, pointerType,
scrollTop — with absent numerics normalized to 0 rather than leaking
`undefined` into library math. `target`/`currentTarget` materialize as proxy
nodes (id-0 listeners get the instance root), `e.target.value`/`checked` are
stamped from the dispatched form state, and a synthesized `composedPath()`
exists for delegated-propagation runtimes. `preventDefault`/`stopPropagation`
are no-ops — the real event already dispatched on the main thread; renderers
should not promise it.

## Writing a worker renderer

Implement `RenderedIslandApp.mount(ctx)`: render into `ctx.doc` with your
framework's native renderer (every mutation already serializes), return
`{ update?, dispose? }`. Omit `update` and `updateProps` degrades to
imperative semantics — dispose + fresh document + remount. `dispose` runs
inside the instance before its document dies — unmount roots, stop effects.
The four `*-island` packages in `packages/` are the reference implementations.

## Testing islands in-process

`@atolljs/core/testing/inProcessWorker` ships a `Worker` test double
that runs the whole protocol in-process — real task registry, real op stream,
real shared-memory binding; only the thread boundary is faked:

```ts
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./my.worker')];

const island = await mountIsland({ worker: () => new Worker(url, { type: 'module' }), ... });
```

Entry modules load lazily on first pool init (like a real worker script — and
even for doorbell-free, message-only pools); a module that throws fires an
`error` event and the worker drops subsequent tasks, so mount failures reject
instead of hanging. `InProcessWorker.created` tracks spawned instances;
`flushObservers()` settles microtasks + the shared-memory observer loop.
