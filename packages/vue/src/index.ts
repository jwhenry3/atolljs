import { onScopeDispose, ref, type Ref } from 'vue';
import { observe, toTask } from '@jwhenry123/mesh/sdk';
import type { AsyncTask, ObservableValue, PathConnector, SharedMemory, SharedSpec, SpecPath, SliceOptions, TaskSnapshot } from '@jwhenry123/mesh/sdk';

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
export function useSharedValue<S extends SharedSpec, K extends SpecPath<S>>(memory: SharedMemory<S>, key: K): Ref<(PathConnector<S, K> extends { read(): infer T } ? T : never) | undefined>;
export function useSharedValue<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: PathConnector<S, K> extends { read(): infer T } ? T : never) => Sel,
  options?: SliceOptions<Sel>
): Ref<Sel | undefined>;
export function useSharedValue<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: never) => Sel,
  options?: SliceOptions<Sel>
) {
  return useObservable(observe(memory, key, select as never, options as never));
}

/** Bind an AsyncTask or plain async fn (via toTask): `{ state }` is a Ref of its snapshot; `run`/`runOnce` trigger it. */
export function useTask<R>(source: AsyncTask<void, R> | (() => Promise<R>)): { state: Ref<TaskSnapshot<R>>; run: AsyncTask<void, R>['run']; runOnce: AsyncTask<void, R>['runOnce'] };
export function useTask<A, R>(source: AsyncTask<A, R> | ((input: A) => Promise<R>)): { state: Ref<TaskSnapshot<R>>; run: AsyncTask<A, R>['run']; runOnce: AsyncTask<A, R>['runOnce'] };
export function useTask<A, R>(source: AsyncTask<A, R> | ((input: A) => Promise<R>)) {
  const task = toTask(source);
  return { state: useObservable(task), run: task.run, runOnce: task.runOnce };
}
