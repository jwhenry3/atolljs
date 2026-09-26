import { onScopeDispose, ref, type Ref } from 'vue';
import { observe } from '@jwhenry123/mesh/sdk';
import type { AsyncTask, ObservableValue, SharedAccess, SharedMemory, SharedSpec, SliceOptions } from '@jwhenry123/mesh/sdk';

/** Wrap any sdk ObservableValue (task snapshot, field observable) in a Ref. */
export function useObservable<T>(source: ObservableValue<T>): Ref<T> {
  const value = ref(source.get()) as Ref<T>;
  const stop = source.subscribe((v) => {
    (value as Ref<T>).value = v;
  });
  onScopeDispose(stop);
  return value;
}

/**
 * Bind one shared-memory field to a Ref. Stays `undefined` until the contract
 * is bound and the field written; updates on every write, local or remote.
 */
export function useSharedValue<S extends SharedSpec, K extends keyof S>(memory: SharedMemory<S>, key: K): Ref<(SharedAccess<S>[K] extends { read(): infer T } ? T : never) | undefined>;
export function useSharedValue<S extends SharedSpec, K extends keyof S, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: SharedAccess<S>[K] extends { read(): infer T } ? T : never) => Sel,
  options?: SliceOptions<Sel>
): Ref<Sel | undefined>;
export function useSharedValue<S extends SharedSpec, K extends keyof S, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: never) => Sel,
  options?: SliceOptions<Sel>
) {
  return useObservable(observe(memory, key, select as never, options as never));
}

/** Bind an AsyncTask: `{ state }` is a Ref of its snapshot; `run`/`runOnce` trigger it. */
export function useTask<A, R>(task: AsyncTask<A, R>) {
  return { state: useObservable(task), run: task.run, runOnce: task.runOnce };
}
