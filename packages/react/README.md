# @atolljs/react

React bindings for `@atolljs/core` — framework adapter only, no domain code.

- `useObservable(source)` — subscribe to any `ObservableValue` via `useSyncExternalStore`.
- `useSharedValue(memory, key)` — a shared-memory field as React state.
- `useTask(task)` — an `AsyncTask` snapshot (`data`/`pending`/`settled`/`elapsedMs`/`error`) plus `run`/`runOnce`.

The consuming app composes these with its own contracts and tasks.
