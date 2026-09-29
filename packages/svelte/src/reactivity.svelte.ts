import { observe, toTask } from '@atolljs/core/sdk';
import type { AsyncTask, ObservableValue, PathConnector, SharedMemory, SharedSpec, SpecPath, SliceOptions } from '@atolljs/core/sdk';

/**
 * Wrap any sdk ObservableValue in rune-backed state. Call during component
 * init — the subscription is torn down when the owning effect is destroyed.
 */
export function observableValue<T>(source: ObservableValue<T>) {
  let value = $state(source.get());
  // Subscribe inside the effect: teardown is registered atomically with the
  // subscription, so a root destroyed before the first flush can't leak it.
  $effect(() => {
    const stop = source.subscribe((v) => (value = v));
    value = source.get();
    return stop;
  });
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
export function sharedValue<S extends SharedSpec, K extends SpecPath<S>>(memory: SharedMemory<S>, key: K): { readonly value: (PathConnector<S, K> extends { read(): infer T } ? T : never) | undefined };
export function sharedValue<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: PathConnector<S, K> extends { read(): infer T } ? T : never) => Sel,
  options?: SliceOptions<Sel>
): { readonly value: Sel | undefined };
export function sharedValue<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: never) => Sel,
  options?: SliceOptions<Sel>
) {
  return observableValue(observe(memory, key, select as never, options as never));
}

/** Bind an AsyncTask — or a plain async fn, wrapped via toTask — to rune state, exposing its snapshot fields plus `run`/`runOnce`. */
export function taskState<R>(source: AsyncTask<void, R> | (() => Promise<R>)): {
  readonly data: R | null; readonly pending: boolean; readonly settled: boolean;
  readonly elapsedMs: number | null; readonly error: unknown;
  run: AsyncTask<void, R>['run']; runOnce: AsyncTask<void, R>['runOnce'];
};
export function taskState<A, R>(source: AsyncTask<A, R> | ((input: A) => Promise<R>)): {
  readonly data: R | null; readonly pending: boolean; readonly settled: boolean;
  readonly elapsedMs: number | null; readonly error: unknown;
  run: AsyncTask<A, R>['run']; runOnce: AsyncTask<A, R>['runOnce'];
};
export function taskState<A, R>(source: AsyncTask<A, R> | ((input: A) => Promise<R>)) {
  const task = toTask(source);
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
