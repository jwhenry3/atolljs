# @atolljs/react-island

The React shell surface for `@atolljs/islands` — mount a worker-hosted React
(or imperative proxy-DOM) tree as an ordinary element in a main-thread React
app. The worker's render loop produces a serialized op stream; this package's
components own the mount lifecycle and replay it onto a real `div`.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)**

## Install

```bash
npm install @atolljs/core @atolljs/islands @atolljs/react-island react react-dom
npm install react-reconciler   # worker islands only — the /worker entry's renderer
```

## `<Island/>`

```tsx
import { Island } from '@atolljs/react-island';
import { ChartsApp } from './worker/apps';

const renderWorker = () =>
  new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });

<Island
  worker={renderWorker}          // or client={connectIslandWorker({...})}
  app={ChartsApp}                // or the registry name 'charts'
  props={{ width: 520 }}         // inferred from ChartsApp's own props
  onEvent={(name, payload) => ...}
  slots={{ preview: (el) => (el ? mountCanvas(el) : teardown()) }}
  onReady={(island) => console.log(island.pid)}
  className="island-box"
/>
```

**Mount by reference, not by string.** `app` accepts the registry key or the
app itself — stamp it once with `islandApp` and both sides share one handle:

```ts
// worker/apps.tsx — the stamp is a data property, minification-proof
export const ChartsApp = islandApp('charts', function ChartsApp(props: ChartsProps) { ... });
export const mapApp = islandApp('map', { imperative: buildMap });
// worker entry: apps: { charts: ChartsApp, map: mapApp }
```

`IslandAppProps` infers `props` from the reference's signature, so
`props={{missing: 1}}` fails to compile. The rendered `div` is the island's
container — `className`/`style`/`data-*` spread onto it. Mounting is async and
cancellation-safe; `props` changes call `updateProps` (deduped by serialized
identity); unmount destroys the island and terminates its worker.

## Worker-loaded component proxies

`islandComponent` and `lazyIsland` return a component that takes the **worker
app's props inline** — the island looks and types like a local component:

```tsx
import { islandComponent, lazyIsland } from '@atolljs/react-island';
import type { TableProps } from './worker/apps'; // type-only: zero bundle cost

// Pure-contract proxy — the shell NEVER imports the implementation.
const TableIsland = islandComponent<TableProps>('data-table');
<TableIsland worker={renderWorker} filter={filter} desc onEvent={…} />

// React.lazy mirror — suspends on the module load (a real split point:
// the worker component's deps only load when the island mounts), then
// mounts by stamped reference.
const ChartsIsland = lazyIsland(() =>
  import('./worker/apps').then((m) => ({ default: m.ChartsApp })),
);
<Suspense fallback="loading…">
  <ChartsIsland worker={renderWorker} width={520} />
</Suspense>
```

The mount window is covered by the `fallback` prop (suspended trees never
commit, so mounting can't suspend). `islandComponent` also takes a stamped
reference (`islandComponent(StampedApp)`) to infer `P` instead of a key +
type parameter.

## Worker topologies

The worker side lives in `@atolljs/react-island/worker` — the entry that
pulls `react` + `react-reconciler` into the worker bundle:

```ts
// render.worker.ts — REGISTRY worker: one script, many named apps
import { defineReactPolyWorker } from '@atolljs/react-island/worker';
export const renderWorker = defineReactPolyWorker({ apps: { charts: ChartsApp, table: TableApp } });

// map.worker.ts — MONO worker: one script, ONE app (1:1), mounted namelessly
import { defineReactMonoWorker } from '@atolljs/react-island/worker';
export const mapWorker = defineReactMonoWorker(mapApp);
```

For a mixed-framework registry, use `@atolljs/islands/worker`'s
`definePolyWorker` and wrap each React app in `reactIslandApp(App)` —
non-React registries never see this entry, so they ship zero React.
`<Slot/>`, `emit`, and `runInInstance` re-export from `/worker` too, so an
app's worker imports need no second specifier.

A mono worker's app resolves regardless of the requested registry name — mount
it with `<Island worker={mapWorker}/>` or `islandComponent<P>()` with no key.
`lazyIsland` accepts the worker module itself as the contract:
`lazyIsland(() => import('./worker/map.worker'))` resolves `{ app, worker }`.

For multi-island-per-worker, share a client:
`client={connectIslandWorker({ worker })}` mounts each island's instance into
the SAME worker (separate reconcilers, op queues, and pids — one OS thread).

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)
- [Worker islands for React](https://jwhenry3.github.io/atolljs/consumer/#/fw-react/worker-islands)
- [Worker islands](https://jwhenry3.github.io/atolljs/consumer/#/islands) —
  `mountIsland` options, `IslandHandle`, island rules
- In-repo internals: [`docs/islands.md`](../../docs/islands.md),
  [`docs/islands-worker.md`](../../docs/islands-worker.md)
