import { useMemo, useSyncExternalStore } from 'react';
import { observe } from '@jwhenry123/mesh/sdk';
import type { AsyncTask, ObservableValue, SharedAccess, SharedMemory, SharedSpec, SliceOptions } from '@jwhenry123/mesh/sdk';

/**
 * Subscribe to any sdk ObservableValue (task snapshot, field observable).
 * SSR-safe: `getServerSnapshot` reuses `get`, which yields `undefined` for
 * fields on unbound contracts.
 */
export function useObservable<T>(source: ObservableValue<T>): T {
  return useSyncExternalStore(source.subscribe, source.get, source.get);
}

/**
 * Bind one shared-memory field to React state. Returns `undefined` until the
 * contract is bound and the field written; re-renders on every write.
 */
export function useSharedValue<S extends SharedSpec, K extends keyof S>(memory: SharedMemory<S>, key: K): (SharedAccess<S>[K] extends { read(): infer T } ? T : never) | undefined;
export function useSharedValue<S extends SharedSpec, K extends keyof S, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: SharedAccess<S>[K] extends { read(): infer T } ? T : never) => Sel,
  options?: SliceOptions<Sel>
): Sel | undefined;
export function useSharedValue<S extends SharedSpec, K extends keyof S, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: never) => Sel,
  options?: SliceOptions<Sel>
) {
  const source = useMemo(() => observe(memory, key, select as never, options as never), [memory, key]);
  return useObservable(source);
}

/** Bind an AsyncTask: its snapshot fields plus `run`/`runOnce` triggers. */
export function useTask<A, R>(task: AsyncTask<A, R>) {
  return { ...useObservable(task), run: task.run, runOnce: task.runOnce };
}
