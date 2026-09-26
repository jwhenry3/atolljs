import { observe } from '@jwhenry123/mesh/sdk';
import type { AsyncTask, ObservableValue, SharedAccess, SharedMemory, SharedSpec, SliceOptions } from '@jwhenry123/mesh/sdk';

/**
 * Wrap any sdk ObservableValue in rune-backed state. Call during component
 * init — the subscription is torn down when the owning effect is destroyed.
 */
export function observableValue<T>(source: ObservableValue<T>) {
  let value = $state(source.get());
  const stop = source.subscribe((v) => (value = v));
  $effect(() => () => stop());
  return {
    get value() {
      return value;
    },
  };
}

/**
 * Bind one shared-memory field to rune state. Stays `undefined` until the
 * contract is bound and the field written; updates on every write.
 */
export function sharedValue<S extends SharedSpec, K extends keyof S>(memory: SharedMemory<S>, key: K): { readonly value: (SharedAccess<S>[K] extends { read(): infer T } ? T : never) | undefined };
export function sharedValue<S extends SharedSpec, K extends keyof S, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: SharedAccess<S>[K] extends { read(): infer T } ? T : never) => Sel,
  options?: SliceOptions<Sel>
): { readonly value: Sel | undefined };
export function sharedValue<S extends SharedSpec, K extends keyof S, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: never) => Sel,
  options?: SliceOptions<Sel>
) {
  return observableValue(observe(memory, key, select as never, options as never));
}

/** Bind an AsyncTask to rune state, exposing its snapshot fields plus `run`/`runOnce`. */
export function taskState<A, R>(task: AsyncTask<A, R>) {
  const s = observableValue(task);
  return {
    get data() {
      return s.value.data;
    },
    get pending() {
      return s.value.pending;
    },
    get settled() {
      return s.value.settled;
    },
    get elapsedMs() {
      return s.value.elapsedMs;
    },
    get error() {
      return s.value.error;
    },
    run: task.run,
    runOnce: task.runOnce,
  };
}
