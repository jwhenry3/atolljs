# React Worker Islands — one worker script, N React trees

A standalone proof that **React's render logic needs no DOM** — scaled out to
islands. The real `react-reconciler@0.34` (the same package react-dom is built
on) runs inside Web Workers with a custom `supportsMutation` host config whose
"host instances" are plain records in a `Map`. Every render-phase and
mutation-phase hook appends a serialized op to a queue; task methods return the
flushed batch, and the main thread's only job is to replay the ops as real DOM
mutations.

**The shell + islands model — worker-hosted microfrontends:** the page
mounts several independent React apps. Each island is its own
`connectWorker` client — one pool, **poolSize pinned to 1**, one worker —
running the **same worker script**. The worker exposes an app registry
(`controls` / `data-table` / `stats`); `mount(app, props)` picks the
component the island renders. There is **no React on the main thread**:
`src/island.ts` is a dumb op applier plus an event sink per island.

**A microfrontend is not limited to one instance.** Islands are identified
by their worker, not their app name — mount `'data-table'` twice and you get
two islands in two different workers, each with its own props and content
(the demo does exactly this: the second `data-table` island starts filtered
to `eu-central`, descending). Mounting the same app *inside one worker*
would collide on the realm key and remount instead — but in production each
worker only ever hosts one realm, so that collision can't happen.
`connectIslandWorker(options)` type-level omits `poolSize`/`worker`/
`sharedMemory` (island-internal) and pins `poolSize: 1` after the spread, so
pooling can't be re-enabled even through a cast — everything else
(`concurrency`, `taskTimeout`, `respawn`, `lazy`…) still passes through.

Islands never talk to each other directly — the **shell mediates**:

```
controls island: emit('filterChanged') ─┐
                                        ├─ shell onEvent → table.updateProps({filter, desc})
controls island: emit('sortChanged') ───┘
table island: emit('rowsChanged') ─────→ shell onEvent → stats.updateProps({visible, total})
both data-table islands: emit('rowSelected') → shell status line
controls island: emit('countChanged') ─→ shell status line
```

Each island's header shows its `whoami()` pid — a random per-realm id proving
every island is a distinct worker (in the in-process test, a distinct render
realm).

## Files

- `src/worker/render.worker.ts` — `defineWorker` entry; app registry + per-realm (`app`/`app@instance` keyed) reconciler/container/queue/pid; exposes `mount` / `updateProps` / `dispatch` / `flush` / `whoami`
- `src/worker/hostConfig.ts` — the ~150-field host config: realm-tagged instances, per-realm op queues, the `emit()` helper
- `src/worker/apps.tsx` — the three island apps: `ControlsApp` (emits filter/sort/counter events), `TableApp` (2000-row memoized table, props-driven, emits rowSelected/rowsChanged), `StatsApp` (row count + busy-loop compute)
- `src/island.ts` — `mountIsland({ client, el, app, props, onEvent })`: per-island DOM driver, doorbell subscription, `{ updateProps, setMode, destroy }`
- `src/main.ts` — the thin shell: layout, one `connectIslandWorker()` + `mountIsland()` per island, event mediation, global transport toggle
- `src/memory.ts` — the doorbell contract: `renderMemory` (worker side) + `makeDoorbell()` (per-island main-side instance)
- `src/ops.ts` — the wire protocol
- `test/islands.test.ts` — in-process E2E (InProcessWorker + happy-dom): distinct pids, emit → updateProps mediation, doorbell flush, remount semantics, same-app multi-instance

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
- `dispatch(handlerId, {type, value, checked, key})` → invokes the prop
  function behind an `__evt` ref; returns the re-render's ops — one
  postMessage round-trip per interaction.
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
