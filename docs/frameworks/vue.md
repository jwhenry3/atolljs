# Vue — `@atolljs/vue` + `@atolljs/vue-island`

Read when: working on `packages/vue/` (binding) or `packages/vue-island/`
(shell + worker renderer for Vue islands).

## Binding — `@atolljs/vue`

Composable adapter producing Refs. Subscriptions release via `onScopeDispose`
when the component unmounts. Source: `packages/vue/src/index.ts`. Example:
`examples/vue/src/useIncidents.ts`, `examples/vue/src/App.vue`.

| Export | Signature | What it does |
|---|---|---|
| `useObservable` | `useObservable(source: ObservableValue<T>): Ref<T>` | Subscribe to any observable snapshot (task or field). |
| `useSharedValue` | `useSharedValue(memory, key, select?, options?): Ref<T \| undefined>` | Bind one shared-memory field to a Ref; optional selector + equality. |
| `useTask` | `useTask(task \| asyncFn): { state: Ref<TaskSnapshot>, run, runOnce }` | Bind an AsyncTask — or any async fn — to a Ref and get its triggers. |

Note: a query spec as a computed Ref + `watch([query, settled])` re-runs the
page task on any change.

## Worker islands — `@atolljs/vue-island`

Two surfaces in one package: shell components that mount a worker-hosted tree
in a Vue app, and `vueIslandApp` — a Vue **worker renderer** running plain
Vue components through Vue's own `createRenderer` with host ops bound to the
instance's proxy document. Every mutation serializes to the op stream the
shell replays as real DOM.

### Shell surface

| Export | Signature | What it does |
|---|---|---|
| `useIsland` | `useIsland({ worker\|client, app, props: () => P, onEvent, slots }): { host, handle, status }` | Headless mount — assign `host` in a template ref; the props getter is tracked, so reactive reads push `updateProps` automatically. |
| `AtollIsland` | `<AtollIsland app worker\|client :props @ready @error />` | Component form — same options as props plus lifecycle emits; renders the island container div itself. |

```vue
<script setup lang="ts">
import { useIsland } from '@atolljs/vue-island';
import { ref } from 'vue';

const width = ref(640);
const { host, handle, status } = useIsland({
  worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
  app: 'charts',                          // or an islandApp-stamped reference
  props: () => ({ width: width.value }),  // getter → tracked, pushes updateProps
  onEvent: (name, payload) => { ... },
});
</script>
<template><div :ref="(el) => (host = el)" class="island-box" /></template>
```

### Worker renderer

| Export | Signature | What it does |
|---|---|---|
| `defineVuePolyWorker` | `defineVuePolyWorker({ apps: { name: Component \| IslandApp } })` | Registry worker — plain Vue components are wrapped in `vueIslandApp` automatically; atoll-islands app shapes can be mixed in. |
| `defineVueMonoWorker` | `defineVueMonoWorker(Component)` | 1:1 instance worker — one script, one app, mounted namelessly. |
| `vueIslandApp` / `vueIsland` | `vueIslandApp(Component): RenderedIslandApp` | The adapter itself — wrap manually when an app needs to sit in a shared `definePolyWorker` registry beside other frameworks. |
| `emit` / `runInInstance` | re-exported from `@atolljs/islands` | The worker entry needs no direct islands import. |

Reference: `examples/react-dom-worker/src/worker/vue.worker.ts` — a real Vue
island worker entry (Vue but no React in its bundle).

### Semantics & notes

- `mount` renders through a module-level `createRenderer` whose host ops map
  onto the instance's proxy document; `island.updateProps` clones the mounted
  root vnode and re-renders, so Vue patches in place (same DOM elements
  survive).
- **Event modifiers cross the wire.** `@click.once`/`.passive`/`.capture`
  become real `addEventListener` options — including worker-side `once`
  auto-detach.
- **Vue's scheduler is a microtask.** State-driven re-renders commit just
  after the dispatch task returns — ops ride the doorbell/`flush()` path
  rather than the dispatch's own batch.
- Conditional anchors (`v-if`/fragment boundaries) are real comment nodes —
  positional anchors driver-side, invisible in output. `Teleport` resolves
  `to` scoped to the instance's document.
- **Requirements**: Vue 3.5+; runtime-only build suffices
  (`h()`/`defineComponent` — no template compiler needed unless your
  components use SFCs, which your bundler compiles as usual).
  `structuredClone`-able props (they cross `postMessage`; `mountIsland`
  rejects uncloneable values naming the offending key).
