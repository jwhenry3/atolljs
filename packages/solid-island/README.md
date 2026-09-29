# @jwhenry123/mesh-solid-island

The Solid shell surface for `@jwhenry123/mesh-worker-dom` — mount a
worker-hosted Solid (or imperative proxy-DOM) tree as an ordinary element
in a main-thread Solid app — plus the Solid **worker renderer** for the
worker side: `solidIslandApp` runs a plain Solid component against
`solid-js/universal`'s `createRenderer` bound to the realm's proxy document,
so every node mutation serializes to the op stream the shell replays as
real DOM.

```bash
npm install @jwhenry123/mesh @jwhenry123/mesh-worker-dom @jwhenry123/mesh-solid-island solid-js
```

## `createIsland` / `Island`

```tsx
import { createIsland } from '@jwhenry123/mesh-solid-island';
import { ChartsApp } from './worker/apps';

const renderWorker = () =>
  new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });

function Shell() {
  const island = createIsland({
    worker: renderWorker,                 // or client={connectIslandWorker({...})}
    app: ChartsApp,                       // or the registry name 'charts'
    props: () => ({ width: width() }),    // accessor — tracked, pushes updateProps
    onEvent: (name, payload) => ...,
    slots: { preview: (el) => el && render(() => <Canvas/>, el) },
  });
  return <div ref={island.ref} class="island-box" />;
}
```

`props` may be a plain value, an accessor, or a reactive getter — changes
call `updateProps`, deduped by serialized identity. Callbacks are read at
call time (fresh closures never remount); `app`/`worker`/`client` are
mount-stable — swap via keyed remount. `Island(options)` is the no-JSX
component form: it returns the mounted `div` itself. All the
[worker-dom island rules](../worker-dom/README.md#island-rules) apply
unchanged.

## The worker renderer: `solidIslandApp` / `defineSolidIslandWorker`

```ts
// counter.worker.ts — the whole worker entry
import { createSignal } from 'solid-js';
import {
  defineSolidIslandWorker,
  h,
  insert,
} from '@jwhenry123/mesh-solid-island/worker';

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

export const worker = defineSolidIslandWorker({ counter: Counter });
// or a 1:1 realm worker: defineRealmWorker(solidIsland('counter', Counter))
```

Mount it namelessly (realm worker) or by registry key —
`createIsland({ app: 'counter', ... })` / `mountIsland({ app: 'counter' })`.

Semantics: `mount` renders the component into the realm's proxy `body` under
a Solid root (so `dispose()` tears down every signal/effect with the
island). Wire props arrive as getter-driven per-key signals, so
`island.updateProps` bumps only the changed keys — the DOM patch that falls
out is exactly as fine-grained as the reads (one `utext`/`attr` op per
changed dependent, never a rebuild). `emit`/`runInRealm` are re-exported for
the island→shell channel.

## Writing JSX (optional)

Components are **plain functions** — nothing in this package requires a JSX
transform (the fixtures above use `h()`/`insert()` by hand). If you want JSX
in worker components, point Solid's compiler at the *universal* render
target with this package's worker entry as the runtime module, **scoped to
worker code only** — your shell components still need the normal DOM
transform:

```ts
// vite.config.ts
import solidPlugin from 'vite-plugin-solid';

export default {
  plugins: [
    // Worker entries: compile JSX to universal-renderer calls.
    solidPlugin({
      include: [/\.worker\.[tj]sx?$/, /worker\/.*\.[tj]sx?$/],
      solid: {
        generate: 'universal',
        moduleName: '@jwhenry123/mesh-solid-island/worker',
      },
    }),
    // Shell (main thread): the regular DOM transform — no options needed.
    solidPlugin({ exclude: [/\.worker\.[tj]sx?$/, /worker\/.*\.[tj]sx?$/] }),
  ],
};
```

Or with babel directly — `["babel-preset-solid", { "generate": "universal",
"moduleName": "@jwhenry123/mesh-solid-island/worker" }]` on the worker
entries' compile scope.

The preset's universal output calls into the runtime surface the worker
entry re-exports — `createElement`, `createTextNode`, `insert`,
`insertNode`, `spread`, `setProp`, `effect`, `memo`, `use`,
`createComponent`, `mergeProps`, `render` (plus `h` for hand-authoring).
Core reactive primitives (`createSignal`, `createEffect`, `mapArray`,
`createContext`…) come straight from `solid-js` as usual.

```tsx
// counter.worker.tsx — same component, JSX form
function Counter(props: { label: string }) {
  const [count, setCount] = createSignal(0);
  return (
    <div class="counter">
      <span class="count">{props.label}: {count()}</span>
      <button class="bump" onClick={() => setCount((c) => c + 1)}>bump</button>
    </div>
  );
}
```

## Caveat: the `worker`/`node` exports condition

`solid-js`'s exports map resolves `solid-js` (and `solid-js/web`,
`solid-js/store`) to `dist/server.js` under the `worker`, `node`, and `deno`
conditions — the SSR build, where effects **never re-run**. That includes
the `import 'solid-js'` inside `solid-js/universal` itself. A renderer built
on the server build mounts fine and then never updates.

Bundlers that compile worker entries with a `worker` condition (custom
esbuild/Vite `resolve.conditions`, some CF/Deno pipelines) hit this — pin
the client build explicitly in the worker build config:

```ts
resolve: { alias: { 'solid-js': 'solid-js/dist/solid.js' } }
// or: omit 'worker'/'node' from resolve.conditions for the worker bundle
```

In this repo, `vitest.config.ts` does the equivalent: an exact-match alias
`/^solid-js$/ → dist/solid.js` plus `server.deps.inline: [/solid-js/]` (so
externalized `node_modules` files — `solid-js/universal` included — resolve
`solid-js` through the same alias instead of Node's exports map, keeping one
reactive module instance everywhere).
