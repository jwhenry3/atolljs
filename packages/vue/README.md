# @atolljs/vue

Vue bindings for `@atolljs/core/sdk` — framework adapter only, no domain code.

- `useObservable(source)` — any `ObservableValue` as a `Ref`.
- `useSharedValue(memory, key)` — a shared-memory field as a `Ref`.
- `useTask(task)` — `{ state }` Ref of the task snapshot plus `run`/`runOnce`.

The consuming app composes these with its own contracts and tasks.
