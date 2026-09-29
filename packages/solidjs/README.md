# @atolljs/solidjs

SolidJS bindings for `@atolljs/core/sdk` — framework adapter only, no domain code.

- `createObservable(source)` — any `ObservableValue` as an `Accessor`.
- `createSharedValue(memory, key)` — a shared-memory field as an `Accessor`.
- `createTask(task)` — `{ state }` Accessor of the task snapshot plus `run`/`runOnce`.

The consuming app composes these with its own contracts and tasks.
