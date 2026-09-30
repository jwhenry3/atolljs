# @atolljs/vue-island

The Vue shell surface for `@atolljs/islands` — mount a worker-hosted tree as
an ordinary element in a main-thread Vue app — plus the Vue **worker
renderer**: a plain Vue component runs through Vue's own `createRenderer` with
host ops bound to the instance's proxy document, so every mutation serializes
to the op stream the shell replays as real DOM.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)**

## Install

```bash
npm install @atolljs/core @atolljs/islands @atolljs/vue-island vue
```

## `useIsland` / `<AtollIsland>`

```vue
<script setup lang="ts">
import { useIsland, AtollIsland } from '@atolljs/vue-island';
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

`<AtollIsland>` is the component form — same options as props plus
`@ready`/`@error` emits.

## The worker renderer

```ts
// counter.worker.ts — the whole worker entry
import { defineComponent, h, ref } from 'vue';
import { defineVuePolyWorker, emit } from '@atolljs/vue-island/worker';

const Counter = defineComponent({
  props: { label: { type: String, default: 'count' } },
  setup(props) {
    const count = ref(0);
    return () =>
      h('button', { onClick: () => { count.value++; emit('bumped', count.value); } },
        `${props.label}: ${count.value}`);
  },
});

export const worker = defineVuePolyWorker({ apps: { counter: Counter } });
// or a 1:1 instance worker: defineVueMonoWorker(Counter)
```

`mount` renders through a `createRenderer` whose host ops map onto the
instance's proxy document; `island.updateProps` clones the mounted root vnode
and re-renders, so Vue patches in place (same DOM elements survive).
`emit`/`runInInstance` are re-exported for the island→shell channel.

## Notes

- **Event modifiers cross the wire** — `@click.once`/`.passive`/`.capture`
  become real `addEventListener` options.
- **Vue's scheduler is a microtask** — state-driven re-renders commit just
  after the dispatch task returns and ride the doorbell/`flush()` path.
- Conditional anchors (`v-if`/fragment boundaries) are real comment nodes.
- Vue 3.5+; runtime-only build suffices (`h()`/`defineComponent` — SFCs
  compile via your bundler as usual).
- Props must be `structuredClone`-able — `mountIsland` rejects uncloneable
  values naming the offending key.

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)
- [Worker islands for Vue](https://jwhenry3.github.io/atolljs/consumer/fw-vue/worker-islands/)
- [Worker islands](https://jwhenry3.github.io/atolljs/consumer/islands/) —
  `mountIsland` options, `IslandHandle`, island rules
- In-repo internals: [`docs/islands.md`](../../docs/islands.md),
  [`docs/islands-worker.md`](../../docs/islands-worker.md)
