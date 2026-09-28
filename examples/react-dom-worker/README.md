# React Worker Islands — one worker script, N React trees

A standalone proof that **React's render logic needs no DOM** — scaled out to
islands. The real `react-reconciler@0.34` (the same package react-dom is built
on) runs inside Web Workers with a custom `supportsMutation` host config whose
"host instances" are plain records in a `Map`. Every render-phase and
mutation-phase hook appends a serialized op to a queue; task methods return the
flushed batch, and the main thread's only job is to replay the ops as real DOM
mutations.

**The whole pattern lives in `@jwhenry123/mesh-worker-dom`** — this example is
the consumer: its worker entry is a ~20-line `defineIslandWorker({ apps })`
call, its shell calls `connectIslandWorker({ worker })` + `mountIsland()`, and
its imperative island demos the worker-side proxy DOM plus the global
`document`/`window` shim.

**The shell + islands model — worker-hosted microfrontends:** the page
mounts several independent islands. Each island is its own
`connectWorker` client — one pool, **poolSize pinned to 1**, one worker —
running the **same worker script**. The worker exposes an app registry
(`controls` / `data-table` / `stats` / `vanilla`); `mount(app, props)`
picks what the island renders. Registry entries are either React
components — reconciled into the realm's own root — or
`{ imperative: (doc, props) => void }` — apps built on the worker-side
**proxy DOM** with no React at all (see below). There is **no React on the
main thread**: `src/island.ts` is a dumb op applier plus an event sink per
island.

**A microfrontend is not limited to one instance.** Islands are identified
by their worker, not their app name — mount `'data-table'` twice and you get
two islands in two different workers, each with its own props and content
(the demo does exactly this: the second `data-table` island starts filtered
to `eu-central`, descending). Mounting the same app *inside one worker*
would collide on the realm key and remount instead — but in production each
worker only ever hosts one realm, so that collision can't happen.
`connectIslandWorker({ worker, ...options })` takes the worker factory (the
package can't know where your entry lives) while `poolSize`/`sharedMemory`
stay island-internal — `poolSize: 1` is pinned after the spread, so pooling
can't be re-enabled even through a cast; everything else (`concurrency`,
`taskTimeout`, `respawn`, `lazy`…) still passes through.

**Transclusion — main-thread DOM inside a worker tree.** A worker app can
render `<Slot name="x"/>` (a leaf `<div data-mesh-slot="x">`): the island
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

**Worker-side proxy DOM — the "WorkerDOM" pattern.** Transclusion covers
libraries that must run on the main thread; `src/worker/proxyDom.ts` covers
the opposite: imperative/DOM-dependent code that should run *inside* the
worker. `createProxyDocument(realm)` builds a fake `document` whose nodes
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

The `vanilla` island proves a realm can be **pure imperative code** — no
reconciler, no JSX, no React import. `mount` runs `build(doc)` inside
`runInRealm` and drains the emitted ops; `updateProps` is documented as
*clear + rebuild on a fresh document*; `dispatch` runs the handler inside
the realm so `emit()` and mutations route to the island's queue.

**The global DOM shim — unmodified libraries in a realm.** `installDomShim(doc)`
puts the realm's proxy document on `globalThis.document` plus a `window`
facade object (navigator/location stubs, timers + rAF, `addEventListener`).
Real DOM-dependent libraries — which reach for globals, build markup with
`innerHTML` (parsed worker-side via htmlparser2), and delegate events on
`document.addEventListener` — then run *unmodified* inside the realm.
`document`/`window` listeners emit `listen` ops on the island's container
(id 0) so delegated handlers see bubbling events, and dispatched payloads
get `target` synthesized to the proxy node (`e.target.closest()` works).
`globalThis.addEventListener`/`self` are never touched — the pool's message
channel lives there. The demo: `src/vendor/miniwidget.js` is a plain-JS
vendored widget mounted inside the vanilla island alongside the
hand-written proxy-DOM code — that's all a real library needs.

Islands never talk to each other directly — the **shell mediates**:

```
controls island: emit('filterChanged') ─┐
                                        ├─ shell onEvent → table.updateProps({filter, desc})
controls island: emit('sortChanged') ───┘
table island: emit('rowsChanged') ─────→ shell onEvent → stats.updateProps({visible, total})
both data-table islands: emit('rowSelected') → shell status line
controls island: emit('countChanged') ─→ shell status line
vanilla island: emit('colorPicked') ───→ shell status line
```

Each island's header shows its `whoami()` pid — a random per-realm id proving
every island is a distinct worker (in the in-process test, a distinct render
realm).

## Files

Package code (`packages/worker-dom/`) does the heavy lifting:
`defineIslandWorker` (realms, reconcilers, op queues), `hostConfig`,
`proxyDom` + `installDomShim`, `mountIsland`/`connectIslandWorker` + the
op protocol + doorbell contract. The example keeps:

- `src/worker/render.worker.ts` — ~20 lines: `defineIslandWorker({ apps })` mapping island app names to components/imperative builders
- `src/worker/apps.tsx` — the three React island apps: `ControlsApp` (emits filter/sort/counter events), `TableApp` (2000-row memoized table, props-driven, emits rowSelected/rowsChanged), `StatsApp` (row count + busy-loop compute)
- `src/worker/vanilla.ts` — the imperative island app: a hand-written swatch picker + log on the proxy DOM, AND the vendored MiniWidget running on `installDomShim`'s globals (no React import)
- `src/vendor/miniwidget.js` (+ `.d.ts`) — a plain-JS "third-party" widget: global `document`, `innerHTML` template, delegated `document.addEventListener` — mounted unmodified inside the island
- `src/main.ts` — the thin shell: layout, one `connectIslandWorker({ worker })` + `mountIsland()` per island, event mediation, global transport toggle
- `test/islands.test.ts` — in-process E2E (InProcessWorker + happy-dom): distinct pids, emit → updateProps mediation, doorbell flush, remount semantics, same-app multi-instance, vendored-widget delegation

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

Main → worker (a realm key rides the wire for routing — `mountIsland` binds
it, so the shell sees `island.updateProps(props)`):

- `mount(realm, props)` → first op batch after a synchronous `updateContainer`
  commit. The realm key is `app` or `app@instance`: the part before the last
  `@` names the registry app, the rest distinguishes instances — which is how
  the same microfrontend can live in multiple islands (mountIsland mints a
  fresh `app@N` per island). Mounting an already-mounted realm key is a
  **remount**: the old tree unmounts (`clear` + detached instances), a fresh
  container renders — the batch replays onto an emptied root; the pid survives.
- `updateProps(realm, props)` → re-render the island's root with new
  serializable props — the shell→island channel.
- `dispatch(handlerId, {type, value, checked, key, clientX, clientY,
  button, scrollTop, targetId})` → invokes the handler behind an `__evt`
  ref or a `listen` op (proxy `addEventListener` registers in the same
  handler table); returns the re-render's ops — one postMessage round-trip
  per interaction. The extra fields are best-effort reads off the DOM
  event: mouse coords/button, the target's scroll offset, and the worker
  instance id of the event target (shell-owned slot content has none).
- `flush(realm)` → drains that realm's ops committed outside a task call
  (passive effects, timers).
- `whoami(realm)` → the realm's random pid.

## Notes & caveats

- **Pooling is disabled for islands — by construction, not just by
  convention.** `connectIslandWorker` omits `poolSize` from its options type
  and pins it to 1 internally. The reason is structural: one reconciled tree
  lives in one worker's memory, and a second worker in the pool would
  receive `dispatch`/`updateProps` calls for a tree it doesn't hold (its
  handler ids and instance ids belong to a different realm). A real pool
  can't serve islands anyway — task routing is least-busy round-robin —
  until the SDK grows sticky routing / per-worker task affinity (documented
  future work). **Scaling out means more islands, not wider pools**: each
  `mountIsland` call is a new worker, and the same microfrontend can be
  mounted as many times as you like — the page shows `data-table` twice with
  different props to prove it.
- **Ops are isolated per island.** Instance ids are only unique within one
  worker, so each island keeps its own nodes/props/listeners maps — sharing
  them would corrupt. On the worker side the same rule applies to ops: each
  instance records the realm key it was created under (`app@N`), and ops
  route to that realm's queue (multi-realm module state exists for the
  in-process test, where one module instance plays every worker — and is
  also what makes same-app multi-instance testable).
- **Slots are transclusion holes.** `data-mesh-slot` marks a leaf element:
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
  props. Don't emit from a passive effect — outside a task there's no realm
  to route the op to.
- **The proxy DOM is write-path-only.** Its reads are served by a local
  shadow tree that only tracks proxy-side mutations — geometry is
  categorically unavailable: `getBoundingClientRect`, `offsetWidth/Height`,
  `scrollTop/scrollHeight`, `getComputedStyle` return 0/empty and warn once
  per document (Partytown-style synchronous reads via `Atomics` blocking
  calls are possible future work — deliberately not faked). `innerHTML` and
  exotic selectors throw clear unsupported errors rather than silently
  diverge. Imperative writes follow the same realm rule as `emit`: they
  must happen inside `runInRealm(realm, fn)` — mount/dispatch provide it
  automatically; worker-initiated work (timers, promise continuations)
  must wrap itself, since instance-bound ops still queue correctly but
  nothing drains them until a task or flush runs.
- **Imperative realms rebuild, not diff.** `updateProps` on an imperative
  realm emits `clear` and re-runs `build(props)` on a fresh proxy document
  (the old document is disposed — its handler ids unregister and mutating
  it throws). That's the honest semantics for code with no reconciler:
  correct for widgets, not for huge trees.
- **One doorbell contract instance per island.** A `SharedMemory` contract
  binds to exactly one buffer; each island's pool creates its own buffer, so
  the shell passes a fresh `makeDoorbell()` per client. The worker script has
  one module-level `renderMemory` — each worker instance binds its own copy.
- **Async updates need `flush()`.** `useEffect` state updates, timers, and
  promise continuations commit on the worker's own scheduler task; their ops
  sit in the realm queue until asked for. `resetAfterCommit` bumps
  `opsVersion`, the island's `observe()` wakes on `Atomics.waitAsync`, and
  `flush(app)` drains — the toolbar's **push/poll** toggle applies to every
  island and is called after all mounts (see `setMode` in island.ts).
- **Every interaction is a round-trip.** A keystroke = postMessage → worker
  re-render → ops back → DOM writes. Cross-island effects add one more hop:
  emit op → shell → `updateProps` task → second worker re-render → ops back.
- **No real DOM in worker code.** React components get no `document`/
  `window`/refs/`useLayoutEffect` reads (using it only for `emit` timing is
  fine — it runs during commit, not render). Imperative code gets the
  *proxy* DOM instead — same-looking API, op-emitting mutations,
  shadow-tree reads, no layout.
- **Events are plain payloads**, not SyntheticEvents:
  `{ type, value, checked, key, clientX, clientY, button, scrollTop,
  targetId }` — the last five are best-effort (`undefined` when the DOM
  event doesn't carry them). React-prop handlers are stable across
  re-renders — each (instance, prop) pair owns one `__evt` slot, so the
  main thread attaches each listener once. Proxy `addEventListener` uses
  the same handler table via `listen`/`unlisten` ops keyed by (type,
  handler id).
- **React DevTools can't see the worker trees** — each island's reconciler is
  a separate copy of React in another realm, and fiber internals don't cross
  postMessage.

## Run

```sh
npm install
npm run dev   # http://localhost:5177
npm run build # tsc --noEmit && vite build → emits a worker chunk
```
