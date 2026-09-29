# @atolljs/solidjs

SolidJS bindings for `@atolljs/core` — shared-memory fields and worker tasks as
natively tracked `Accessor`s (the SDK uses `solid-js` internally for its
reactive core). Subscriptions auto-dispose via `onCleanup` when the owner is
destroyed.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)**

## Install

```bash
npm install @atolljs/core @atolljs/solidjs
```

## Usage

```tsx
import { createSharedValue, createTask } from '@atolljs/solidjs';
import { counterMemory } from './counter.memory';
import { counter } from './counter';

export function App() {
  const count = createSharedValue(counterMemory, 'count');
  const increment = createTask(counter.increment);

  return (
    <button onClick={() => increment.run(1)}>
      count: {count() ?? '…'}
    </button>
  );
}
```

## API

- `createObservable(source)` — subscribe to any `ObservableValue` snapshot as
  an `Accessor`.
- `createSharedValue(memory, key, select?, options?)` — bind one shared-memory
  field to an `Accessor`; optional selector + `equals`.
- `createTask(task | asyncFn)` — bind an `AsyncTask` (or any async fn) to
  `{ state: Accessor<TaskSnapshot> }` plus `run`/`runOnce` triggers.

## Notes

- Worker-hosted Solid trees (islands) live in the companion package
  [`@atolljs/solid-island`](../solid-island).

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)
- [SolidJS guide](https://jwhenry3.github.io/atolljs/consumer/#/fw-solid)
- [Worker islands for Solid](https://jwhenry3.github.io/atolljs/consumer/#/fw-solid/worker-islands)
