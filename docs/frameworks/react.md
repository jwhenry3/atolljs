# React — `@atolljs/react` + `@atolljs/react-island`

Read when: working on `packages/react/` (binding) or `packages/react-island/`
(shell components for worker islands).

## Binding — `@atolljs/react`

Hook adapter over `useSyncExternalStore`. SSR-safe — field reads return
`undefined` until the contract binds on the client.
Source: `packages/react/src/index.ts`. Example glue/view:
`examples/react/src/useIncidents.ts`, `examples/react/src/App.tsx`.

| Export | Signature | What it does |
|---|---|---|
| `useObservable` | `useObservable(source: ObservableValue<T>): T` | Subscribe to any observable snapshot (task or field). |
| `useSharedValue` | `useSharedValue(memory, key, select?, options?): T \| undefined` | Bind one shared-memory field; optional selector + equality to slice updates. |
| `useTask` | `useTask(task \| asyncFn): { data, pending, settled, elapsedMs, error, run, runOnce }` | Bind an AsyncTask — or any async fn (e.g. a client method, wrapped via `toTask`) — to state and get its triggers. |

Notes: memoize query objects (`useMemo`) so effects only re-fire when the spec
actually changes; `runOnce()` makes init tasks StrictMode-safe (double mounts
skip a second run).

## Worker islands — `@atolljs/react-island`

A worker-hosted React (or imperative proxy-DOM) tree mounted as an ordinary
element in a React shell. The worker's render loop produces serialized DOM
ops; the components own the mount lifecycle and replay them onto a real `div`.
See [../islands.md](../islands.md) for the engine, topologies, and options —
all the island rules apply unchanged.

### The proxy API

| Export | Signature | What it does |
|---|---|---|
| `lazyIsland` | `lazyIsland(loader: () => Promise<{ default: A } \| A>): FC<IslandAppProps<A> & IslandShellProps>` | React.lazy mirrored — suspends on the dynamic import (a real bundler split point), then mounts the stamped app by reference with props inferred from its signature. |
| `islandComponent` | `islandComponent<P>('name')` \| `islandComponent(StampedApp)` | The pure-contract proxy — the shell never imports the implementation; a registry key + a type-only props import is the whole contract. |
| `Island` | `<Island app={ref\|name} worker props onEvent slots onReady/>` | The underlying building block — declarative `mountIsland` as a component. `props` dedups by serialized identity. |
| `islandApp` | `islandApp('name', app)` | Stamps an app (component or `{imperative}` def) with its registry name — a data property, so references survive minification. Bare components fall back to `displayName`/`fn.name` — dev convenience; bundlers mangle `fn.name`, which is what the stamp exists for. |
| `definePolyWorker` / `defineMonoWorker` | from `atoll-islands/worker` | Registry worker (many named apps, shareable clients) vs the 1:1 instance worker (mounted namelessly, minimal bundle). |
| `Slot` / `emit` | `<Slot name>` / `emit(name, payload)` | Transclusion leaf + island→shell channel — see [../islands-worker.md](../islands-worker.md). |

### Mounting — the proxies make islands look local

Each `lazyIsland` loader returns the `islandApp`-stamped component, so props
infer from the worker component's own signature and the dynamic import
code-splits worker dependencies (recharts fetches only when the charts island
mounts — a static import pulls ~500 kB into the shell chunk eagerly).
`<Suspense>` covers the module load; the proxy's `fallback` prop covers the
worker-mount window — mounting can't suspend because a suspended tree never
commits and the container must be in the DOM first.

Reference shell: `examples/react-dom-worker/src/shell.tsx` — mounts all seven
demo islands via `lazyIsland` proxies, with the mediation pattern
(`onEvent → setState → <Island props>`) replacing hand-wired `updateProps`.

`lazyIsland` also accepts the worker module itself as the contract:
`lazyIsland(() => import('./worker/map.worker'))` resolves `{ app, worker }`
so the island carries its own worker.

### Notes

- **Mediation is unidirectional** — an island's `emit` lands in `onEvent`, the
  shell sets state, and it flows back in as props.
- **Two fallback phases:** `<Suspense>` for the module load, the proxy's
  `fallback` prop for the worker mount.
- **Fixed-dimension libs** (recharts) get width/height as props — measurement
  reads on the proxy DOM return zero for everything but the container.
- **Structural walls stay walls:** closed libraries that need real DOM
  (Google Maps JS) are housed via transclusion slots or iframe elements — the
  worker owns the box, the shell owns the contents.
