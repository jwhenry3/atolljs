# @atolljs/svelte

Svelte 5 bindings for `@atolljs/core` — shared-memory fields and worker tasks
as rune-backed state. Call the factories during component init (or in a
`.svelte.ts` module); teardown happens in an `$effect` cleanup.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)**

## Install

```bash
npm install @atolljs/core @atolljs/svelte
```

## Usage

```svelte
<script lang="ts">
  import { sharedValue, taskState } from '@atolljs/svelte';
  import { counterMemory } from './counter.memory';
  import { counter } from './counter';

  const count = sharedValue(counterMemory, 'count');
  const increment = taskState(counter.increment);
</script>

<button onclick={() => increment.run(1)}>
  count: {count.value ?? '…'}
</button>
```

## API

- `observableValue(source)` — subscribe to any `ObservableValue` snapshot as
  `{ value }` rune state.
- `sharedValue(memory, key, select?, options?)` — bind one shared-memory field
  as `{ value }` rune state; optional selector + `equals`.
- `taskState(task | asyncFn)` — bind an `AsyncTask` (or any async fn) to
  snapshot getters (`data`/`pending`/`settled`/`elapsedMs`/`error`) plus
  `run`/`runOnce` triggers.

## Notes

- Worker-hosted Svelte trees (islands) live in the companion package
  [`@atolljs/svelte-island`](../svelte-island).

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)
- [Svelte guide](https://jwhenry3.github.io/atolljs/consumer/#/fw-svelte)
- [Worker islands for Svelte](https://jwhenry3.github.io/atolljs/consumer/#/fw-svelte/worker-islands)
