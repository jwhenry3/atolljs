# React in a Worker — DOM ops over postMessage

A standalone proof that **React's render logic needs no DOM**. The real
`react-reconciler@0.34` (the same package react-dom is built on) runs inside a
Web Worker with a custom `supportsMutation` host config whose "host instances"
are plain records in a `Map`. Every render-phase and mutation-phase hook
appends a serialized op to a queue; task methods return the flushed batch, and
the main thread's only job is to replay the ops as real DOM mutations.

There is **no React on the main thread** — `src/main.ts` is a dumb op applier.
The ops themselves always ride postMessage; the toolbar at the top of the page
switches how async commits get *noticed*: **push** uses a SharedArrayBuffer
doorbell (`opsVersion` bumped per commit, `observe()` wakes via
`Atomics.waitAsync`), **poll** uses a 50 ms `setInterval`. Push mode is why
the dev server sends COOP/COEP — the poll path needs none of it, which is the
message-only/shared-memory tradeoff made visible.

## Files

- `src/worker/render.worker.ts` — `defineWorker` entry; owns the reconciler, exposes `mount`/`dispatch`/`flush`
- `src/worker/hostConfig.ts` — the ~150-field host config: instances as `{ id, type, props }` records, ops emitted per hook
- `src/worker/App.tsx` — demo app: memoized 2000-row list, filter input, sort toggle, counter, busy-loop compute
- `src/main.ts` — main thread: `connectWorker` client + `applyOps` DOM driver + transport toggle
- `src/memory.ts` — the doorbell contract: one `opsVersion` counter
- `src/ops.ts` — the wire protocol

## Protocol

Worker → main, batches of:

| op | shape | meaning |
| --- | --- | --- |
| `create` | `{id, type, props}` | `document.createElement(type)` + props (`{__evt:id}` → listener) |
| `text` | `{id, text}` | `document.createTextNode(text)` |
| `append` | `{parent, child, before?}` | `parent.insertBefore(child, before ?? null)`; parent `0` = root |
| `remove` | `{child}` | detach the node |
| `update` | `{id, props}` | full re-serialized prop set; main diffs vs. its last set |
| `utext` | `{id, text}` | `node.textContent = text` |
| `clear` | `{}` | clear the root container |

Main → worker:

- `mount()` → first op batch after a synchronous `updateContainer(<App/>)` commit
- `dispatch(handlerId, {type, value, checked, key})` → invokes the prop function
  behind an `__evt` ref; returns the re-render's ops — one postMessage
  round-trip per interaction
- `flush()` → drains ops committed outside a task call (passive effects, timers)

## Notes & caveats

- **poolSize must be 1.** One reconciled tree lives in one worker's memory. A
  second worker would emit ops for a different tree with colliding instance
  ids; the main thread's node map would corrupt. This is inherent to the
  single-tree design, not a pool limitation to lean on.
- **Every interaction is a round-trip.** A keystroke = postMessage → worker
  re-render → ops back → DOM writes. Fine for this demo; latency-sensitive UI
  would want the ops batched or the update moved closer to the input.
- **No DOM in worker components.** No `document`/`window`/refs/`useLayoutEffect`
  reads — render output is the only interface to the page.
- **Events are plain payloads**, not SyntheticEvents: `{ type, value, checked,
  key }`. Handlers are stable across re-renders — each (instance, prop) pair
  owns one `__evt` slot, so the main thread attaches each listener once.
- **Text children are text instances.** `shouldSetTextContent` always returns
  `false`, so `"hello {x}"` becomes `text`/`append`/`utext` ops rather than a
  `textContent` prop — structure stays uniform in the protocol.
- **React DevTools can't see the worker tree** — the reconciler is a separate
  copy of React in another realm, and `HostTransitionContext`/`act`/fiber
  internals don't cross postMessage.
- **Async updates need `flush()`.** `useEffect` state updates, timers, and
  promise continuations commit on the worker's own scheduler task; their ops
  sit in the queue until asked for. The pool protocol has no push channel, so
  the doorbell pattern supplies it: `hostConfig.resetAfterCommit` bumps
  `opsVersion` in shared memory, the main thread's `observe()` wakes on
  `Atomics.waitAsync` and calls `flush()`. Toggle to **poll** in the toolbar
  and the same flush runs on a 50 ms `setInterval` — watch the flush-call
  counter to see what the doorbell saves (each poll tick is a round trip that
  usually returns `[]`).
- **Commits are synchronous only inside tasks.** `mount`/`dispatch` wrap work
  in `flushSyncFromReconciler`, which pins the update lane to sync and flushes
  in its `finally` — `updateContainer` alone in 0.34 only *schedules*.
- No COOP/COEP headers — none needed without SharedArrayBuffer.

## Run

```sh
npm install
npm run dev   # http://localhost:5177
npm run build # tsc --noEmit && vite build → emits a worker chunk
```
