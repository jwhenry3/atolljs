# @atolljs/react

React bindings for `@atolljs/core` — hooks that bind shared-memory fields and
worker tasks to component state over `useSyncExternalStore`. SSR-safe: field
reads return `undefined` until the contract binds on the client.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)**

## Install

```bash
npm install @atolljs/core @atolljs/react
```

## Usage

```tsx
import { useSharedValue, useTask } from '@atolljs/react';
import { counterMemory } from './counter.memory';
import { counter } from './counter';

export function App() {
  const count = useSharedValue(counterMemory, 'count');
  const increment = useTask(counter.increment);  // client method → latest-wins task

  return (
    <button onClick={() => increment.run(1)}>
      count: {count ?? '…'}
    </button>
  );
}
```

## API

- `useObservable(source)` — subscribe to any `ObservableValue` snapshot (task or field).
- `useSharedValue(memory, key, select?, options?)` — bind one shared-memory
  field to React state; optional selector + `equals` slice updates so a
  component re-renders only when its slice changes.
- `useTask(task | asyncFn)` — bind an `AsyncTask` (or any async fn, e.g. a
  `connectWorker` client method) to `{ data, pending, settled, elapsedMs,
  error }` plus `run`/`runOnce` triggers.

## Notes

- `counter.increment` is typed from the worker's `defineWorker` methods — no
  task contract to declare.
- Worker-hosted React trees (islands) live in the companion package
  [`@atolljs/react-island`](../react-island).

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)
- [React guide](https://jwhenry3.github.io/atolljs/consumer/fw-react/)
- [Worker islands for React](https://jwhenry3.github.io/atolljs/consumer/fw-react/worker-islands/)
