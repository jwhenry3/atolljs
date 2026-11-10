# Error boundaries: the island safety net

Read when: wiring failure handling into worker islands — `mountIsland({ boundary })`,
the facade `boundary` props, or the underlying `client.onWorkerEvent` seam.

Every breakable point in the mount lifecycle now has a boundary hook:

| Point | What fails | Boundary covers it via |
|---|---|---|
| Worker boot | entry script errors, bad URL | mount rejection → `'mount'` phase |
| Mount handshake | `mountTimeout`, contract prop rejection, unknown app, federation `loadApp` failures (bad remote, unsatisfied `requires`) | mount rejection → `'mount'` phase |
| Runtime crash | worker's `error` event mid-life — every instance on that client dies | `client.onWorkerEvent('error')` → `'runtime'` phase |
| Recovery | respawned worker holds nothing — the island must remount | `retry()` / `boundary.retry` policy → fresh mount attempt |

What it deliberately does NOT cover: `updateProps`/`dispatch` task rejections
(contract violations, uncloneable props). Those are caller errors — they
reject their own promises and reach `onError` callbacks the facades already
expose, same as before.

## The boundary option

```ts
await mountIsland({
  worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
  el, app: 'charts',
  boundary: {
    loading: () => spinnerEl,                          // during the first attempt
    error: ({ error, phase, retry }) => errorPanel(error, retry),
    retry: 3,                                          // or (attempt, err) => ms | false
    onError: (err, phase) => telemetry(err, phase),
    domOnError: 'preserve',                            // overlay on the stale frame
  },
});
```

Render functions are framework-free: they return `Node | string | (Node|string)[]`
applied to the island's container. `loading`/`error`-cleared replace its
contents; `domOnError: 'preserve'` appends the fallback over the stale last
frame on runtime crashes. `ctx` carries `{ app, el, attempt, error, phase, retry }`.

The promise resolves after the FIRST attempt settles — the caller always gets
an `IslandBoundaryHandle` (`state: 'loading'|'mounted'|'error'`, `error`,
`retry()`); a failed mount never becomes an unhandled rejection. `updateProps`
while failed stashes into the next attempt's props; `retry()` remounts in place.

Retry policy: `retry: N` allows N remount attempts (delay ≈250ms×attempt, cap 2s);
`retry: (attempt, err) => ms | false` gives full control — return `false`/nothing
to stop. On a crash the runner respawns the worker as usual; the retry remounts
the same instance key into the fresh realm (federation hosts re-run `loadApp`,
so remotes re-import there too).

## Facades

`boundary` passes through everywhere `mountIsland` options do:

- React `<Island boundary={…}/>` + `islandComponent`/`lazyIsland` shell props
- Vue `useIsland({ boundary })`, `<AtollIsland :boundary>`, `v-island`/`islandComponent` attrs
- Svelte `use:island={{ boundary }}`
- Solid `createIsland({ boundary })` / `<Island boundary>`; Angular `[boundary]` input

The render fns return DOM nodes. For JSX/template fallbacks either render into a
detached node yourself or keep your own state — facades still surface the failure
through their existing `onError`/`status`/`error` channels in parallel.

## The seam underneath: worker lifecycle events

`client.onWorkerEvent(fn)` subscribes to `'error' | 'respawn' | 'terminate'`
transitions (`WorkerLifecycleEvent { type, poolId, slot?, message? }`) on any
`connectWorker` client — dedicated or pooled — plus `onLifecycle` on
`ConnectWorkerConfig`/`WorkerPoolConfig`/`DedicatedWorkerConfig` for
construction-time listeners. Subscribing before the pool spawns is fine;
listeners survive `terminate()`+respawn cycles. Use it directly for non-island
boundaries (pooled compute clients, custom supervision).

## Shared-client semantics

A crash kills EVERY instance on the client — every island boundary mounted
into it enters `'error'` independently (one reason isolation-heavy MFEs stay
on `worker:`-shorthand or remote worker bundles). Retry policy is per island,
so siblings recover at their own pace.

## Limits

- Nested islands (proxy-element `el`) ignore `boundary` — the sub-mounter path
  has its own lifecycle; shell-side boundaries wrap the parent.
- `respawn: false` clients can't recover: `retry` attempts reject with
  `WorkerCrashedError` and the boundary stays in `'error'` — honest, visible.
