# @atolljs/vue

Vue bindings for `@atolljs/core` — composables that bind shared-memory fields
and worker tasks to `Ref`s. Subscriptions release via `onScopeDispose` when the
component unmounts.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)**

## Install

```bash
npm install @atolljs/core @atolljs/vue
```

## Usage

```vue
<script setup lang="ts">
import { useSharedValue, useTask } from '@atolljs/vue';
import { counterMemory } from './counter.memory';
import { counter } from './counter';

const count = useSharedValue(counterMemory, 'count');
const increment = useTask(counter.increment);
</script>

<template>
  <button @click="increment.run(1)">
    count: {{ count ?? '…' }}
  </button>
</template>
```

## API

- `useObservable(source)` — subscribe to any `ObservableValue` snapshot as a `Ref`.
- `useSharedValue(memory, key, select?, options?)` — bind one shared-memory
  field to a `Ref`; optional selector + `equals`.
- `useTask(task | asyncFn)` — bind an `AsyncTask` (or any async fn) to
  `{ state: Ref<TaskSnapshot> }` plus `run`/`runOnce` triggers.

## Notes

- `watch()` the task's `settled` Ref to trigger follow-up work after a run.
- Worker-hosted Vue trees (islands) live in the companion package
  [`@atolljs/vue-island`](../vue-island).

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)
- [Vue guide](https://jwhenry3.github.io/atolljs/consumer/fw-vue/)
- [Worker islands for Vue](https://jwhenry3.github.io/atolljs/consumer/fw-vue/worker-islands/)
