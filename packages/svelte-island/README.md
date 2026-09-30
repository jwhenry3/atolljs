# @atolljs/svelte-island

[![CI](https://github.com/jwhenry3/atolljs/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jwhenry3/atolljs/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jwhenry3/atolljs/graph/badge.svg?branch=main)](https://codecov.io/gh/jwhenry3/atolljs)
[![Socket Badge](https://badge.socket.dev/npm/package/@atolljs/svelte-island)](https://badge.socket.dev/npm/package/@atolljs/svelte-island)

The Svelte shell surface for `@atolljs/islands` — mount a worker-hosted tree
as an ordinary element in a main-thread Svelte app — plus the Svelte 5
**worker renderer**: a compiled component runs with the real
`mount()`/`unmount()` against the instance's proxy document, so every DOM call
the Svelte runtime makes serializes to the op stream the shell replays as real
DOM.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)**

## Install

```bash
npm install @atolljs/core @atolljs/islands @atolljs/svelte-island svelte
```

## The `island` action / `createIslandState`

```svelte
<script lang="ts">
  import { island } from '@atolljs/svelte-island';
  let width = $state(640);
</script>

<div use:island={{
  worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
  app: 'charts',                    // or an islandApp-stamped reference
  props: { width },                 // action update() → updateProps
  onEvent: (name, payload) => { ... },
}} class="island-box" />
```

`createIslandState(options)` is the headless form — mount/attach yourself and
read `status`/`error`/`handle` as reactive `$state`. `worker`/`client`/`app`
are mount-stable — swap them through `{#key}`.

## The worker renderer

```ts
// counter.worker.ts — the whole worker entry
import Counter from './Counter.svelte';
import { defineSveltePolyWorker, emit } from '@atolljs/svelte-island/worker';

export const worker = defineSveltePolyWorker({ apps: { counter: Counter } });
// or a 1:1 instance worker: defineSvelteMonoWorker(Counter)
```

```svelte
<!-- Counter.svelte — a completely ordinary component -->
<script lang="ts">
  import { emit } from '@atolljs/svelte-island/worker';
  let { label = 'count' } = $props();
  let count = $state(0);
</script>
<button onclick={() => { count++; emit('bumped', count); }}>{label}: {count}</button>
```

`mount` runs the component's real `mount()` into `doc.body` with a
`$state`-backed props box — `island.updateProps` mutates the box and Svelte
patches in place. Event dispatches end with a `flushSync()` so state updates
land in the dispatch's own op batch. `emit`/`runInInstance` are re-exported
for the island→shell channel.

## Requirements

- **Svelte 5 with runes-compiled components** — components must be compiled
  by vite-plugin-svelte / the Svelte compiler for the client target; there is
  no legacy/SSR fallback.
- `{#if}`/`{#each}`/`{@html}` anchors rely on the proxy DOM's comment nodes
  and template handling — bundled, no setup needed.
- Props must be `structuredClone`-able — `mountIsland` rejects uncloneable
  values naming the offending key.

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)
- [Worker islands for Svelte](https://jwhenry3.github.io/atolljs/consumer/fw-svelte/worker-islands/)
- [Worker islands](https://jwhenry3.github.io/atolljs/consumer/islands/) —
  `mountIsland` options, `IslandHandle`, island rules
- In-repo internals: [`docs/islands.md`](../../docs/islands.md),
  [`docs/islands-worker.md`](../../docs/islands-worker.md)
