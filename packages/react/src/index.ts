import { useMemo, useSyncExternalStore } from 'react';
import { observe, toTask } from '@atolljs/core/sdk';
import type { AsyncTask, ObservableValue, PathConnector, SharedMemory, SharedSpec, SpecPath, SliceOptions } from '@atolljs/core/sdk';

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
export function useSharedValue<S extends SharedSpec, K extends SpecPath<S>>(memory: SharedMemory<S>, key: K): (PathConnector<S, K> extends { read(): infer T } ? T : never) | undefined;
export function useSharedValue<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: PathConnector<S, K> extends { read(): infer T } ? T : never) => Sel,
  options?: SliceOptions<Sel>
): Sel | undefined;
export function useSharedValue<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: never) => Sel,
  options?: SliceOptions<Sel>
) {
  const source = useMemo(() => observe(memory, key, select as never, options as never), [memory, key]);
  return useObservable(source);
}

/**
 * Bind an AsyncTask — or a plain async function (e.g. a worker client's
 * method), wrapped via toTask: its snapshot fields plus `run`/`runOnce`.
 */
export function useTask<R>(source: AsyncTask<void, R> | (() => Promise<R>)): {
  data: R | null; pending: boolean; settled: boolean; elapsedMs: number | null; error: unknown;
  run: AsyncTask<void, R>['run']; runOnce: AsyncTask<void, R>['runOnce'];
};
export function useTask<A, R>(source: AsyncTask<A, R> | ((input: A) => Promise<R>)): {
  data: R | null; pending: boolean; settled: boolean; elapsedMs: number | null; error: unknown;
  run: AsyncTask<A, R>['run']; runOnce: AsyncTask<A, R>['runOnce'];
};
export function useTask<A, R>(source: AsyncTask<A, R> | ((input: A) => Promise<R>)) {
  const task = useMemo(() => toTask(source), [source]);
  return { ...useObservable(task), run: task.run, runOnce: task.runOnce };
}
