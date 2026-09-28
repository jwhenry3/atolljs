# React Worker Islands — one worker script, N React trees

A standalone proof that **React's render logic needs no DOM** — scaled out to
islands. The real `react-reconciler@0.34` (the same package react-dom is built
on) runs inside Web Workers with a custom `supportsMutation` host config whose
"host instances" are plain records in a `Map`. Every render-phase and
mutation-phase hook appends a serialized op to a queue; task methods return the
flushed batch, and the main thread's only job is to replay the ops as real DOM
mutations.

**The shell + islands model:** the page mounts several independent React apps.
Each island is its own `connectWorker` client — one pool, `poolSize: 1`, one
worker — running the **same worker script**. The worker exposes an app
registry (`controls` / `data-table` / `stats`); `mount(app, props)` picks the
component the island renders. There is **no React on the main thread**:
`src/island.ts` is a dumb op applier plus an event sink per island.

Islands never talk to each other directly — the **shell mediates**:

```
controls island: emit('filterChanged') ─┐
                                        ├─ shell onEvent → table.updateProps({filter, desc})
controls island: emit('sortChanged') ───┘
table island: emit('rowsChanged') ─────→ shell onEvent → stats.updateProps({visible, total})
table island: emit('rowSelected') ─────→ shell status line
controls island: emit('countChanged') ─→ shell status line
```

Each island's header shows its `whoami()` pid — a random per-realm id proving
every island is a distinct worker (in the in-process test, a distinct render
realm).

## Files

- `src/worker/render.worker.ts` — `defineWorker` entry; app registry + per-realm reconciler/container/queue/pid; exposes `mount` / `updateProps` / `dispatch` / `flush` / `whoami`
- `src/worker/hostConfig.ts` — the ~150-field host config: realm-tagged instances, per-realm op queues, the `emit()` helper
- `src/worker/apps.tsx` — the three island apps: `ControlsApp` (emits filter/sort/counter events), `TableApp` (2000-row memoized table, props-driven, emits rowSelected/rowsChanged), `StatsApp` (row count + busy-loop compute)
- `src/island.ts` — `mountIsland({ client, el, app, props, onEvent })`: per-island DOM driver, doorbell subscription, `{ updateProps, setMode, destroy }`
- `src/main.ts` — the thin shell: layout, one `connectIslandWorker()` + `mountIsland()` per island, event mediation, global transport toggle
- `src/memory.ts` — the doorbell contract: `renderMemory` (worker side) + `makeDoorbell()` (per-island main-side instance)
- `src/ops.ts` — the wire protocol
- `test/islands.test.ts` — in-process E2E (InProcessWorker + happy-dom): distinct pids, emit → updateProps mediation, doorbell flush, remount semantics

## Protocol

Worker → main, batches of:

| op | shape | meaning |
| --- | --- | --- |
| `create` | `{id, type, props}` | `document.createElement(type)` + props (`{__evt:id}` → listener) |
| `text` | `{id, text}` | `document.createTextNode(text)` |
| `append` | `{parent, child, before?}` | `parent.insertBefore(child, before ?? null)`; parent `0` = island root |
| `remove` | `{child}` | detach the node |
| `update` | `{id, props}` | full re-serialized prop set; main diffs vs. its last set |
| `utext` | `{id, text}` | `node.textContent = text` |
| `clear` | `{}` | clear the island's root container |
| `emit` | `{name, payload}` | **not** a DOM op — invokes the island's `onEvent(name, payload)` |

Main → worker (the app name rides the wire for realm routing — `mountIsland`
binds it, so the shell sees `island.updateProps(props)`):

- `mount(app, props)` → first op batch after a synchronous `updateContainer`
  commit. Mounting an already-mounted app is a **remount**: the old tree
  unmounts (`clear` + detached instances), a fresh container renders — the
  batch replays onto an emptied root; the pid survives.
- `updateProps(app, props)` → re-render the island's root with new
  serializable props — the shell→island channel.
- `dispatch(handlerId, {type, value, checked, key})` → invokes the prop
  function behind an `__evt` ref; returns the re-render's ops — one
  postMessage round-trip per interaction.
- `flush(app)` → drains that realm's ops committed outside a task call
  (passive effects, timers).
- `whoami(app)` → the realm's random pid.

## Notes & caveats

- **poolSize: 1 is inherent per island.** One reconciled tree lives in one
  worker's memory; every island gets its own pool instead of sharing a bigger
  one. A real pool can't serve islands today anyway — task routing is
  least-busy round-robin, so a second worker would receive `dispatch` calls
  for a tree it doesn't hold (its handler ids are a different worker's).
  Sticky routing / per-worker task affinity is documented future work.
- **Ops are isolated per island.** Instance ids are only unique within one
  worker, so each island keeps its own nodes/props/listeners maps — sharing
  them would corrupt. On the worker side the same rule applies to ops: each
  instance records the realm it was created under, and ops route to that
  realm's queue (multi-realm module state exists for the in-process test,
  where one module instance plays every worker).
- **`emit` is the island→shell channel.** Island code calls `emit(name,
  payload)` inside event handlers or commit-phase effects (the demo uses
  `useLayoutEffect` for `rowsChanged`). Payloads are structured-cloned like
  props. Don't emit from a passive effect — outside a task there's no realm
  to route the op to.
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
- **No DOM in worker components.** No `document`/`window`/refs/`useLayoutEffect`
  reads (using it only for `emit` timing is fine — it runs during commit, not
  render).
- **Events are plain payloads**, not SyntheticEvents: `{ type, value, checked,
  key }`. Handlers are stable across re-renders — each (instance, prop) pair
  owns one `__evt` slot, so the main thread attaches each listener once.
- **React DevTools can't see the worker trees** — each island's reconciler is
  a separate copy of React in another realm, and fiber internals don't cross
  postMessage.

## Run

```sh
npm install
npm run dev   # http://localhost:5177
npm run build # tsc --noEmit && vite build → emits a worker chunk
```
