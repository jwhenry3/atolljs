# @atolljs/angular

Angular bindings for `@atolljs/core` — framework adapter only, no domain code.
Signal-based; call in an injection context (field initializer or constructor)
so subscriptions are released on destroy.

- `observableSignal(source)` — any `ObservableValue` as a `Signal`.
- `sharedValue(memory, key)` — a shared-memory field as a `Signal`.
- `taskState(task)` — `{ state }` Signal of the task snapshot plus `run`/`runOnce`.

The consuming app composes these with its own contracts and tasks.
