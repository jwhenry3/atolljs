# @atolljs/solid-island

The Solid shell surface for `@atolljs/islands` — mount a worker-hosted Solid
(or imperative proxy-DOM) tree as an ordinary element in a main-thread Solid
app — plus the Solid **worker renderer**: a plain Solid component runs against
`solid-js/universal`'s `createRenderer` bound to the instance's proxy
document, so every node mutation serializes to the op stream the shell replays
as real DOM.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)**

## Install

```bash
npm install @atolljs/core @atolljs/islands @atolljs/solid-island solid-js
```

## `createIsland` / `Island`

```tsx
import { createIsland } from '@atolljs/solid-island';
import { ChartsApp } from './worker/apps';

const renderWorker = () =>
  new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });

function Shell() {
  const island = createIsland({
    worker: renderWorker,                 // or client: connectIslandWorker({...})
    app: ChartsApp,                       // or the registry name 'charts'
    props: () => ({ width: width() }),    // accessor — tracked, pushes updateProps
    onEvent: (name, payload) => ...,
    slots: { preview: (el) => el && render(() => <Canvas/>, el) },
  });
  return <div ref={island.ref} class="island-box" />;
}
```

`props` may be a plain value, an accessor, or a reactive getter — changes call
`updateProps` (deduped by serialized identity). Callbacks are read at call
time; `app`/`worker`/`client` are mount-stable — swap via keyed remount.
`Island(options)` is the no-JSX component form: it returns the mounted `div`
itself.

## The worker renderer

```ts
// counter.worker.ts — the whole worker entry
import { createSignal } from 'solid-js';
import { defineSolidPolyWorker, h, insert } from '@atolljs/solid-island/worker';

function Counter(props: { label: string }) {
  const [count, setCount] = createSignal(0);
  const label = h('span', { class: 'count' });
  insert(label, () => `${props.label}: ${count()}`);   // tracked accessor
  const bump = h('button', {
    class: 'bump',
    onClick: () => setCount((c) => c + 1),             // → addEventListener → listen op
  }, 'bump');
  return h('div', { class: 'counter' }, label, bump);
}

export const worker = defineSolidPolyWorker({ apps: { counter: Counter } });
// or a 1:1 instance worker: defineSolidMonoWorker(Counter)
```

`mount` renders the component into the instance's proxy `body` under a Solid
root (so `dispose()` tears down every signal/effect with the island). Wire
props arrive as getter-driven per-key signals, so `island.updateProps` bumps
only the changed keys — one `utext`/`attr` op per changed dependent, never a
rebuild. `emit`/`runInInstance` are re-exported for the island→shell channel.

## Writing JSX (optional)

Components are **plain functions** — nothing here requires a JSX transform
(`h()`/`insert()` by hand works). For JSX in worker components, point Solid's
compiler at the *universal* render target with this package's worker entry as
the runtime module, **scoped to worker code only** — shell components still
need the normal DOM transform:

```ts
// vite.config.ts
export default {
  plugins: [
    // Worker entries: compile JSX to universal-renderer calls.
    solidPlugin({
      include: [/\.worker\.[tj]sx?$/, /worker\/.*\.[tj]sx?$/],
      solid: { generate: 'universal', moduleName: '@atolljs/solid-island/worker' },
    }),
    // Shell (main thread): the regular DOM transform.
    solidPlugin({ exclude: [/\.worker\.[tj]sx?$/, /worker\/.*\.[tj]sx?$/] }),
  ],
};
```

Or with babel directly — `["babel-preset-solid", { "generate": "universal",
"moduleName": "@atolljs/solid-island/worker" }]` on the worker entries'
compile scope. Core reactive primitives (`createSignal`, `createEffect`,
`mapArray`, `createContext`…) come straight from `solid-js` as usual.

## Caveats

- **Pin the client build.** `solid-js`'s exports map resolves to the SSR
  build (`dist/server.js` — effects never re-run) under the `worker`, `node`,
  and `deno` conditions, including the `import 'solid-js'` inside
  `solid-js/universal` itself. If your bundler compiles worker entries with a
  `worker` condition, pin the client build in the worker build config:
  `resolve: { alias: { 'solid-js': 'solid-js/dist/solid.js' } }` or omit
  `worker`/`node` from `resolve.conditions`. The adapter probes and throws if
  the SSR build slips in anyway.
- **`el.textContent` vs `insert()` children.** Setting `el.textContent` emits
  one `utext` op ("replace all children") and records a *phantom* text child
  with no wire identity — an element that also holds `insert()`-managed
  children will drift. Dynamic text goes through `insert()` as a real text
  node; compiled universal JSX already does this.

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)
- [Worker islands for Solid](https://jwhenry3.github.io/atolljs/consumer/#/fw-solid/worker-islands)
- [Worker islands](https://jwhenry3.github.io/atolljs/consumer/#/islands) —
  `mountIsland` options, `IslandHandle`, island rules
- In-repo internals: [`docs/islands.md`](../../docs/islands.md),
  [`docs/islands-worker.md`](../../docs/islands-worker.md)
