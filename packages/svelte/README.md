# @jwhenry123/mesh/svelte

Svelte 5 bindings for `@jwhenry123/mesh/sdk` — framework adapter only, no domain code.
Rune-based; call during component init.

- `observableValue(source)` — any `ObservableValue` as `{ value }` rune state.
- `sharedValue(memory, key)` — a shared-memory field as `{ value }` rune state.
- `taskState(task)` — task snapshot getters (`data`/`pending`/`settled`/`elapsedMs`/`error`) plus `run`/`runOnce`.

The consuming app composes these with its own contracts and tasks.
