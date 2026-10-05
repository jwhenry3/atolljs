# React Worker Islands — registry + instance workers, N React trees

A standalone proof that **React's render logic needs no DOM** — scaled out to
islands. The real `react-reconciler@0.34` (the same package react-dom is built
on) runs inside Web Workers with a custom `supportsMutation` host config whose
"host instances" are plain records in a `Map`. Every render-phase and
mutation-phase hook appends a serialized op to a queue; task methods return the
flushed batch, and the main thread's only job is to replay the ops as real DOM
mutations.

**The whole pattern lives in `@atolljs/islands`** — this example is
the consumer: its worker entries are ~20-line `definePolyWorker({ apps })` /
`defineMonoWorker(app)` calls, its shell calls `connectIslandWorker({ worker })`
+ `mountIsland()`, and its imperative island demos the worker-side proxy DOM
plus the global `document`/`window` shim.

**The shell + islands model — worker-hosted microfrontends, two worker
topologies.** The demo mixes them deliberately:

- **Registry worker** (`definePolyWorker({ apps })`) — `render.worker.ts`
  serves the React apps (`controls` / `data-table` / `stats` / `charts`) by
  name. Islands each get a `connectWorker` client pinned to **`workers: 1`**:
  one dedicated worker, no pool. The React shell goes further: the two
  `data-table` islands share ONE client, so both instances live in a single
  worker — separate reconcilers, op queues, and pids in one OS thread —
  and `destroy()` unmounts a instance without killing its sibling's worker.
- **Instance workers** (`defineMonoWorker(app)`) — `map.worker.ts` and
  `vanilla.worker.ts` are the 1:1 form: one script, one app, mounted
  namelessly (a single-app worker resolves its sole app whatever name is
  asked). Their bundles carry only that app's dependencies — no recharts,
  no other React apps.

Registry entries are either React components — reconciled into the instance's
own root — or `{ imperative: (doc, props) => void }` — apps built on the
worker-side **proxy DOM** with no React usage (see below). There is **no
React on the main thread of `index.html`**: `src/island.ts` is a dumb op
applier plus an event sink per island. (If your shell *is* a React app,
`@atolljs/react-island` exports `<Island/>` — the same
mount/updateProps/destroy lifecycle as a component — see `react-shell.html`.)

**A microfrontend is not limited to one instance.** Instance keys are
`app@N` — minted per island — so `'data-table'` mounts twice with
independent props and content, whether into separate workers (the vanilla
shell) or the same one (the React shell's shared client). `unmount` on the
wire tears a instance down without touching its siblings.
`connectIslandWorker({ worker, ...options })` takes the worker factory (the
package can't know where your entry lives) while `workers`/`poolSize`/`sharedMemory`
stay island-internal: `workers: 1` is pinned after the spread, so pooling
can't be re-enabled even through a cast; everything else (`taskTimeout`,
`respawn`, `lazy`…) still passes through.

**Transclusion — main-thread DOM inside a worker tree.** A worker app can
render `<Slot name="x"/>` (a leaf `<div data-atoll-slot="x">`): the island
owns the element's *box* — its layout, styles, and position in the op
stream — while the shell owns its *contents*. When the create op lands, the
driver calls `mountIsland({ slots: { x: (el) => … } })` with the real
element; mount a canvas, a Monaco editor, an AG Grid, or even a
`createRoot()` of main-thread React inside it — real DOM, real events, zero
wire traffic. The demo's stats island hosts a live waveform canvas drawn
by `requestAnimationFrame` on the main thread. Removal works too: when the
worker drops the element (directly or inside a removed subtree), the slot
callback fires with `null` for teardown. This is the escape hatch for every
library in the "structurally can't run in a worker" bucket — it doesn't
port into the worker, it gets *transcluded* around it.

**Two shells, same islands.** The demo ships two entry pages to prove the
op protocol doesn't care what the shell is made of. `index.html` +
`src/main.ts` is framework-free: `mountIsland({ el, app, props })` calls
plus hand-wired `island.updateProps` mediation — its bundle is ~4 kB.
It is also the all-frameworks page: a framework row mounts the `counter`
app from the Svelte, Solid and Angular workers beside the React, Vue,
imperative and Leaflet islands, so the devtools app map (open with
`?__atoll_devtools`) shows every supported renderer at once.
`react-shell.html` + `src/shell.tsx` mounts five islands through
`<Island/>` (`@atolljs/react-island`): each `mountIsland` call
becomes a component, badges ride `onReady` → state, and
island→shell mediation is literally `onEvent → setState →
<Island props={…}>` — the component's deduped `updateProps` replaces the
hand-wiring. All five mount through **`lazyIsland` proxies**, so
the worker app types like a local component with props inline —
`<TableIsland filter={f} desc/>` — and every dynamic import is a code-split
boundary covered by `<Suspense>` (react-shell chunk ~230 kB; recharts,
leaflet, and the imperative apps fetch as separate lazy chunks only when
their island mounts). The `fallback` prop covers the worker-mount window —
mount can't suspend because suspended trees never commit and mounting
needs the container in the DOM.

For shells that want zero worker-module imports, `islandComponent<P>('name')`
builds the same proxy from a registry key + type-only props contract.
And plain `<Island app="vanilla"/>` string mounting stays supported.

**An island inside an island.** The `nestedhost` panel is the nesting
proof: its worker-side React tree renders `<SubIsland/>`
(`@atolljs/react-island`), which spawns `nested.worker.tsx` — a real
sub-worker created *inside* `react.worker.tsx` — and mounts the `nested`
counter app into a proxy element of the parent instance. The surface is
the same `mountIsland` the shell uses: a proxy `el` switches the driver
to a nested mounter that replays the sub-worker's ops into the parent's
shadow tree, so the inner DOM tunnels upward through the outer island's
own op stream (the page sees one flat batch). Clicks round-trip two hops:
real event → outer dispatch → proxy listener → sub-worker handler → ops
back up — and the sub-worker's `emit` lands in the outer island's
`onEvent`, which re-emits to the shell status line. The sub-instance keys
hierarchically (`nestedhost@1~nested@1`), push and poll transports both
work, and the devtools app map draws the parent→sub-worker→sub-island
branch. (`SubIsland` is an alias: new worker code imports `Island` from
`@atolljs/react-island/worker`, the same component the shell uses.)

**The ops console: one PolyWorker, three topologies.** The bottom of
`react-shell.html` mounts a second definition, `src/worker/console.worker.tsx`
(apps `pulse`, `export`, `regions`), in every shape the API offers:

| Row | Mount | Topology | Press the heavy button and… |
|---|---|---|---|
| A | `pulse` + `export` with `client={opsShared}` | 1 worker, 2 instances | the shared pulse freezes for the whole ~1.2s export |
| B | `pulse` + `export` with `worker={consoleWorker}` each | 2 workers, same script | the isolated pulse keeps ticking |
| C | `regions` with `worker={consoleWorker}` | 1 worker that nests `region.worker.tsx` twice | a region recompute stalls all three cards (one shared sub-client); the forecast model stalls nothing (its own sub-worker) |

Inside `regions`, the nested mounts use the shell's own API: `<Island
client={cards}>` per region card (where `cards = connectIslandWorker({ worker:
regionEntry })` lives in a `useState` initializer inside the worker) and
`<Island worker={regionEntry} app="forecast"/>`, both imported from
`@atolljs/react-island/worker`. Every card and pulse shows its "longest
stall", measured from how late its own `setInterval` fires, and a
main-thread heartbeat above the rows shows the page never stalls at all.
The scenario stands in for a real ops dashboard: live telemetry that must
keep updating, CPU-heavy report exports, and per-region widgets next to a
capacity model.

**Worker-side proxy DOM — the "WorkerDOM" pattern.** Transclusion covers
libraries that must run on the main thread; `src/worker/proxyDom.ts` covers
the opposite: imperative/DOM-dependent code that should run *inside* the
worker. `createProxyDocument(instance)` builds a fake `document` whose nodes
wrap the same host-instance records the reconciler uses — one `instances`
map, one id counter — so `createElement`, `appendChild`, `setAttribute`,
`classList`, `dataset`, `el.style.x`, `addEventListener`, and
`textContent` all emit ordinary ops instead of touching real DOM. Each
node also maintains a local **shadow tree** (`childNodes`/`parentNode`/
`firstChild`/`nextSibling`/`children`/`textContent` reads, plus
`getElementById` and a simple `querySelector`), so imperative code can
read back what it wrote — the only DOM reads that CAN work over an async
op channel. Because ops are id-addressed, proxy-created elements can nest
inside React-rendered parents and vice versa; `doc.adopt(instance)` wraps
any shared instance record for imperative navigation.

The `vanilla` island proves a instance can be **pure imperative code** — no
reconciler, no JSX, no React import. `mount` runs `build(doc)` inside
`runInInstance` and drains the emitted ops; `updateProps` is documented as
*clear + rebuild on a fresh document*; `dispatch` runs the handler inside
the instance so `emit()` and mutations route to the island's queue.

**The global DOM shim — unmodified libraries in a instance.** `installDomShim(doc)`
puts the instance's proxy document on `globalThis.document` plus a `window`
facade object (navigator/location stubs, timers + rAF, `addEventListener`).
Real DOM-dependent libraries — which reach for globals, build markup with
`innerHTML` (parsed worker-side via htmlparser2), and delegate events on
`document.addEventListener` — then run *unmodified* inside the instance.
`document`/`window` listeners emit `listen` ops on the island's container
(id 0) so delegated handlers see bubbling events, and dispatched payloads
get `target` synthesized to the proxy node (`e.target.closest()` works).
`globalThis.addEventListener`/`self` are never touched — the pool's message
channel lives there. The demo: `src/vendor/miniwidget.js` is a plain-JS
vendored widget mounted inside the vanilla island alongside the
hand-written proxy-DOM code — that's all a real library needs.

**The `map` island — real Leaflet 1.9, unmodified, in a worker.** The
stress test for the whole shim: `src/worker/map.ts` installs the DOM shim,
dynamically imports Leaflet (required — it reads `document`/`window` at
module scope), and mounts `L.map(doc.body)`. Tile `<img>`s, divIcon
markers, zoom/attribution controls, a custom place-picker control,
drag-pan, and wheel zoom all work through the op stream — Leaflet's
`Draggable` registers document-level `mousemove`/`mouseup` listeners
mid-gesture via `listen` ops, `ScrollWheelZoom`'s debounce timer emits
`zoomChanged` from outside any task (wrapped in `runInInstance` +
`bumpOpsVersion`), and delegated marker clicks route through Leaflet's
`_targets` stamp table onto proxy-element expandos. What makes it possible
is the one geometry channel: the driver's `ResizeObserver` pushes the
island container's size (`setSize`), which `doc.body` reports to Leaflet's
container measurements; `doc.onResize` replays it as `invalidateSize()`.
The stylesheet is shell-side (`import 'leaflet/dist/leaflet.css'`), and
tiles are real `<img>` elements — see the note on COEP `credentialless` in
`vite.config.ts` for why cross-origin tiles load under isolation.

**The `charts` island — real recharts 3.x, unmodified, inside a React
island.** Where Leaflet stresses the imperative shim, recharts stresses the
*React* machinery: `src/worker/apps.tsx`'s `ChartsApp` renders an ordinary
`ComposedChart` (grid, axes, tooltip, legend, bar + line — `isAnimationActive`
off to skip measurement churn). It works because of four general renderer
capabilities, not recharts-specific hacks: **namespaced SVG** — host context
tracks `<svg>`/`<foreignObject>` boundaries and ops carry a namespace so the
driver calls `createElementNS` (portal children inherit their target's
namespace too); **refs return proxy facades** — `getPublicInstance` hands
libraries a `ProxyElement`, so recharts' tooltip/legend `createPortal` target
(the wrapper's ref) is a valid container the host methods unwrap back to its
instance; **instance-aware globals** — `document`/`window`/`Element` resolve per
instance (inside tasks the active instance's doc, otherwise the sole/last-active
instance's — and plain assignments still override for out-of-instance code), so
recharts' `getComputedStyle`, selector calls (`getElementsByClassName`/
`getElementsByTagName`), and portal bookkeeping run unmodified; and
**event-object semantics** — dispatched payloads get `target`/`currentTarget`
synthesized to the owning proxy node, which is what the chart's mouse
middleware reads geometry from (honest zeros). A bar click updates local
state and emits `chartClicked` — one dispatch round-trip, like every other
interaction. The limits are the ones you'd predict: chart dimensions are
**fixed props** (`ResponsiveContainer` can't observe real layout without a
measurement channel), and geometry-reading features (tooltip positioning)
settle on stub values — SVG `getBBox`/`getTotalLength`/`offsetWidth` warn
once and return 0.

Islands never talk to each other directly — the **shell mediates**:

```
controls island: emit('filterChanged') ─┐
                                        ├─ shell onEvent → table.updateProps({filter, desc})
controls island: emit('sortChanged') ───┘
table island: emit('rowsChanged') ─────→ shell onEvent → stats.updateProps({visible, total})
both data-table islands: emit('rowSelected') → shell status line
controls island: emit('countChanged') ─→ shell status line
vanilla island: emit('colorPicked') ───→ shell status line
map island: emit('markerClicked' / 'placeSelected' / 'zoomChanged') → shell status line
charts island: emit('chartClicked') ─────────────────────────────────────────→ shell status line
nestedhost island: emit('nestedIncremented') ── relayed from the SUB-worker ──→ shell status line
ops console export islands: emit('exported') ────────────────────────────────→ shell status line
regions island: emit('regionRecomputed' / 'forecasted') ── relayed from region sub-workers → shell status line
```

Each island's header shows its `whoami()` pid — a random per-instance id proving
every island is a distinct worker (in the in-process test, a distinct render
instance).

## Files

Package code (`packages/islands/` + `packages/react-island/`) does the
heavy lifting: `definePolyWorker` (instances, reconcilers, op queues),
`hostConfig`, `proxyDom` + `installDomShim`, `mountIsland`/
`connectIslandWorker` + the op protocol + doorbell contract, and the
`<Island/>`/`lazyIsland`/`islandComponent` component layer. The example
keeps:

- `src/worker/render.worker.ts` — ~20 lines: `definePolyWorker({ apps })` mapping island app names to components/imperative builders
- `src/worker/react.worker.tsx` — the React shell's registry worker: counter/notes/incidents plus `nestedhost`, a React app whose tree mounts `<SubIsland/>` (an island inside the island)
- `src/worker/nested.worker.tsx` — the nested island's entry: an ordinary `defineReactPolyWorker` spawned *inside* react.worker (worker → sub-worker)
- `src/worker/console.worker.tsx` — the ops console's PolyWorker: `pulse` (heartbeat + longest stall), `export` (~1.2s synchronous aggregation), and `regions` (nests region.worker on a shared sub-client and via `worker`)
- `src/worker/region.worker.tsx` — the nested PolyWorker spawned inside console.worker: `region` cards (live SLA + recompute) and the `forecast` model
- `src/worker/opsKit.ts` — helpers both console definitions import (`useHeartbeat`, `aggregate`): a shared dependency each spawned worker evaluates on its own
- `src/worker/apps.tsx` — the four React island apps: `ControlsApp` (emits filter/sort/counter events), `TableApp` (2000-row memoized table, props-driven, emits rowSelected/rowsChanged), `StatsApp` (row count + busy-loop compute), `ChartsApp` (real recharts 3.x `ComposedChart`, fixed dims, emits `chartClicked` on bar click)
- `src/worker/vanilla.ts` — the imperative island app: a hand-written swatch picker + log on the proxy DOM, AND the vendored MiniWidget running on `installDomShim`'s globals (no React import)
- `src/worker/map.ts` — the map island app: `installDomShim` + dynamic `import('leaflet')`, then unmodified Leaflet 1.9 (`L.map`, tile layer, divIcon markers, a `L.Control.extend` place picker) on the proxy DOM
- `src/vendor/miniwidget.js` (+ `.d.ts`) — a plain-JS "third-party" widget: global `document`, `innerHTML` template, delegated `document.addEventListener` — mounted unmodified inside the island
- `src/main.ts` — the thin framework-free shell: layout, one `connectIslandWorker({ worker })` + `mountIsland()` per island, event mediation, global transport toggle, `import 'leaflet/dist/leaflet.css'`
- `src/shell.tsx` + `react-shell.html` — the React shell: the same seven islands mounted through `<Island/>` plus the `islandComponent`/`lazyIsland` proxies (inline worker-app props, Suspense for the module load, code-split recharts), state-driven mediation
- `test/islands.test.ts` — in-process E2E (InProcessWorker + happy-dom): distinct pids, emit → updateProps mediation, doorbell flush, remount semantics, same-app multi-instance, vendored-widget delegation
- `test/map.test.ts` — in-process E2E for the Leaflet island: tiles, markers, controls, delegated marker/place clicks, drag-pan, wheel zoom, `zoomChanged`/`markerClicked`/`placeSelected` emits
- `test/charts.test.ts` — in-process E2E for the recharts island: main surface + descendants carry the SVG namespace (zIndex portals included), grid/axis/bar markup lands, bar click emits `chartClicked` with the datum
- `test/shell.test.tsx` — in-process E2E for the React shell: `<Shell/>` mounts all seven islands via `<Island/>`, badges/stats aggregate in React-rendered DOM, controls→table mediation flows through state → `props`

## Protocol

Worker → main, batches of:

| op | shape | meaning |
| --- | --- | --- |
| `create` | `{id, type, props}` | `document.createElement(type)` + props (`{__evt:id}` → listener) |
| `text` | `{id, text}` | `document.createTextNode(text)` |
| `append` | `{parent, child, before?}` | `parent.insertBefore(child, before ?? null)`; parent `0` = island root |
| `remove` | `{child}` | detach the node |
| `update` | `{id, props}` | full re-serialized prop set; main diffs vs. its last set |
| `utext` | `{id, text}` | `node.textContent = text` (also proxy `element.textContent` writes) |
| `attr` | `{id, name, value\|null}` | proxy DOM attributes — set/removeAttribute with setProp's property heuristics; `null` removes |
| `style` | `{id, props}` | proxy DOM inline-style deltas — merge into `el.style`, `''` clears a key |
| `listen` | `{id, type, handler}` | proxy `addEventListener` — driver wires `handler` → `client.dispatch` |
| `unlisten` | `{id, type, handler}` | detach the listener a `listen` op attached |
| `clear` | `{}` | clear the island's root container (React remounts and imperative rebuilds) |
| `emit` | `{name, payload}` | **not** a DOM op — invokes the island's `onEvent(name, payload)` |

Main → worker (a instance key rides the wire for routing — `mountIsland` binds
it, so the shell sees `island.updateProps(props)`):

- `mount(instance, props)` → first op batch after a synchronous `updateContainer`
  commit. The instance key is `app` or `app@instance`: the part before the last
  `@` names the registry app, the rest distinguishes instances — which is how
  the same microfrontend can live in multiple islands (mountIsland mints a
  fresh `app@N` per island). Mounting an already-mounted instance key is a
  **remount**: the old tree unmounts (`clear` + detached instances), a fresh
  container renders — the batch replays onto an emptied root; the pid survives.
- `updateProps(instance, props)` → re-render the island's root with new
  serializable props — the shell→island channel.
- `dispatch(handlerId, payload)` → invokes the handler behind an `__evt`
  ref or a `listen` op (proxy `addEventListener` registers in the same
  handler table); returns the re-render's ops — one postMessage round-trip
  per interaction. The payload is `EventPayload` — pointer-family events
  carry normalized numeric coords/deltas/buttons (see the events caveat);
  `targetId` maps the event target to its worker instance id when it's an
  op-created node (shell-owned slot content has none).
- `setSize(instance, w, h)` → pushes the island container's measured box into
  the instance — the ONLY geometry channel. The driver calls it once at mount
  and on container resizes (throttled); imperative instances additionally fire
  their `doc.onResize` handlers and return their ops in the batch.
- `flush(instance)` → drains that instance's ops committed outside a task call
  (passive effects, timers).
- `whoami(instance)` → the instance's random pid.

## Notes & caveats

- **Pooling is disabled for islands — by construction, not just by
  convention.** `connectIslandWorker` omits `workers`/`poolSize` from its
  options type and pins `workers: 1` internally, which builds a
  `DedicatedWorker` (no pool, no queue). The reason is structural: one reconciled tree
  lives in one worker's memory, and a second worker in the pool would
  receive `dispatch`/`updateProps` calls for a tree it doesn't hold (its
  handler ids and instance ids belong to a different instance). A real pool
  can't serve islands anyway — task routing is least-busy round-robin —
  until the SDK grows sticky routing / per-worker task affinity (documented
  future work). **Scaling out means more islands, not wider pools**: each
  `mountIsland` call is a new worker, and the same microfrontend can be
  mounted as many times as you like — the page shows `data-table` twice with
  different props to prove it.
- **Ops are isolated per island.** Instance ids are only unique within one
  worker, so each island keeps its own nodes/props/listeners maps — sharing
  them would corrupt. On the worker side the same rule applies to ops: each
  instance records the instance key it was created under (`app@N`), and ops
  route to that instance's queue (multi-instance module state exists for the
  in-process test, where one module instance plays every worker — and is
  also what makes same-app multi-instance testable).
- **Slots are transclusion holes.** `data-atoll-slot` marks a leaf element:
  the driver calls `slots[name](el)` when it appears and `slots[name](null)`
  when the worker tree removes it — including when it's inside a subtree cut
  by a single `remove` op (the driver finds nested slots via the DOM
  attribute). Keep slot elements leaf-only on the worker side, and note
  there's no measurement channel: the island lays out the box but can't read
  the pixel size of what the shell put inside it — feed that back via
  `dispatch`/`updateProps` if a worker app needs it.
- **`emit` is the island→shell channel.** Island code calls `emit(name,
  payload)` inside event handlers or commit-phase effects (the demo uses
  `useLayoutEffect` for `rowsChanged`). Payloads are structured-cloned like
  props. Don't emit from a passive effect — outside a task there's no instance
  to route the op to.
- **The proxy DOM is write-path plus ONE measured box.** Its reads are
  served by a local shadow tree that only tracks proxy-side mutations, and
  geometry is limited to the pushed container size: the driver's
  `ResizeObserver` calls `setSize(instance, w, h)` (once at mount, then
  throttled on resize), and `doc.body`/`documentElement`/`markContainer`ed
  elements report it via `clientWidth`/`offsetWidth`/`getBoundingClientRect`.
  That single box is what lets Leaflet size its pane tree. Everything else —
  arbitrary-element `getBoundingClientRect`, `scrollTop/scrollHeight`,
  `getComputedStyle` — returns 0/empty and warns once per document
  (Partytown-style synchronous reads via `Atomics` blocking calls are
  possible future work — deliberately not faked). Imperative writes follow
  the same instance rule as `emit`: they must happen inside
  `runInInstance(instance, fn)` — mount/dispatch provide it automatically;
  worker-initiated work (timers, promise continuations, library callbacks
  like Leaflet's `zoomend`) must wrap itself and ring the doorbell
  (`bumpOpsVersion()`), since ops still queue correctly but nothing drains
  them until a task or flush runs — and `emit` outside a instance drops the op.
- **Imperative instances rebuild, not diff.** `updateProps` on an imperative
  instance emits `clear` and re-runs `build(props)` on a fresh proxy document
  (the old document is disposed — its handler ids unregister and mutating
  it throws). That's the honest semantics for code with no reconciler:
  correct for widgets, not for huge trees.
- **One doorbell contract instance per island.** A `SharedMemory` contract
  binds to exactly one buffer; each island's pool creates its own buffer, so
  the shell passes a fresh `makeDoorbell()` per client. The worker script has
  one module-level `renderMemory` — each worker instance binds its own copy.
- **Async updates need `flush()`.** `useEffect` state updates, timers, and
  promise continuations commit on the worker's own scheduler task; their ops
  sit in the instance queue until asked for. `resetAfterCommit` bumps
  `opsVersion`, the island's `observe()` wakes on `Atomics.waitAsync`, and
  `flush(app)` drains — push mode (the default) subscribes automatically at
  mount; the toolbar's **push/poll** toggle just switches modes.
- **Every interaction is a round-trip.** A keystroke = postMessage → worker
  re-render → ops back → DOM writes. Cross-island effects add one more hop:
  emit op → shell → `updateProps` task → second worker re-render → ops back.
- **No real DOM in worker code — but library DOM glue works.** React
  components get no real `document`/`window`/`useLayoutEffect` reads (using
  it only for `emit` timing is fine — it runs during commit, not render).
  Imperative code gets the *proxy* DOM instead — same-looking API,
  op-emitting mutations, shadow-tree reads, no layout. And the globals ARE
  defined now: `definePolyWorker` installs a instance-aware dispatcher so
  `document`/`window`/`Element` resolve to the executing instance's proxy doc
  (plain assignments still win out-of-instance — `installDomShim` composes on
  top). Refs point at `ProxyElement` facades (valid `createPortal`
  containers — recharts uses them), geometry reads still honest-zero.
- **Events are plain payloads**, not SyntheticEvents:
  `{ type, value, checked, key, clientX/Y, screenX/Y, button, which,
  modifiers, deltaX/Y, deltaMode, pointerType, scrollTop, targetId }`.
  Pointer-family events (mouse/pointer/wheel/drag/click…) always carry
  *numeric* coordinates — the driver normalizes absent fields to 0 so
  worker-side event math (`e.clientX - rect.left`) never sees `undefined`;
  non-pointer events leave them `undefined`. `preventDefault`/
  `stopPropagation` on the payload are synthesized no-ops — the real event
  already dispatched; the worker can't cancel it. During dispatch the
  handler also gets `target`/`currentTarget` materialized as proxy nodes
  (`currentTarget` = the element the listener was registered on, the instance
  root for document-level listeners) — library code reading geometry off
  them gets honest zeros instead of `undefined` crashes. React-prop handlers are
  stable across re-renders — each (instance, prop) pair owns one `__evt`
  slot, so the main thread attaches each listener once. Proxy
  `addEventListener` uses the same handler table via `listen`/`unlisten`
  ops keyed by (type, handler id).
- **React DevTools can't see the worker trees** — each island's reconciler is
  a separate copy of React in another instance, and fiber internals don't cross
  postMessage.

## Run

```sh
npm install
npm run dev   # http://localhost:5177 (framework-free shell)
              # http://localhost:5177/react-shell.html (React + <Island/>)
npm run build # tsc --noEmit && vite build → emits a worker chunk
```
