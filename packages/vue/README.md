# @jwhenry123/mesh/vue

Vue bindings for `@jwhenry123/mesh/sdk` — framework adapter only, no domain code.

- `useObservable(source)` — any `ObservableValue` as a `Ref`.
- `useSharedValue(memory, key)` — a shared-memory field as a `Ref`.
- `useTask(task)` — `{ state }` Ref of the task snapshot plus `run`/`runOnce`.

The consuming app composes these with its own contracts and tasks.
