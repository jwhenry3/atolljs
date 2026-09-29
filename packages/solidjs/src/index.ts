import { createSignal, onCleanup, type Accessor } from 'solid-js';
import { observe, toTask } from '@atolljs/core';
import type { AsyncTask, ObservableValue, PathConnector, SharedMemory, SharedSpec, SpecPath, SliceOptions, TaskSnapshot } from '@atolljs/core';

/** Wrap any sdk ObservableValue (task snapshot, field observable) in an Accessor. */
export function createObservable<T>(source: ObservableValue<T>): Accessor<T> {
  const [value, setValue] = createSignal(source.get(), { equals: false });
  onCleanup(source.subscribe((v) => setValue(() => v)));
  return value;
}

/**
 * Bind one shared-memory field to an Accessor. Stays `undefined` until the
 * contract is bound and the field written; updates on every write.
 */
export function createSharedValue<S extends SharedSpec, K extends SpecPath<S>>(memory: SharedMemory<S>, key: K): Accessor<(PathConnector<S, K> extends { read(): infer T } ? T : never) | undefined>;
export function createSharedValue<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: PathConnector<S, K> extends { read(): infer T } ? T : never) => Sel,
  options?: SliceOptions<Sel>
): Accessor<Sel | undefined>;
export function createSharedValue<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: never) => Sel,
  options?: SliceOptions<Sel>
) {
  return createObservable(observe(memory, key, select as never, options as never));
}

/** Bind an AsyncTask or plain async fn (via toTask): `{ state }` is an Accessor of its snapshot; `run`/`runOnce` trigger it. */
export function createTask<R>(source: AsyncTask<void, R> | (() => Promise<R>)): { state: Accessor<TaskSnapshot<R>>; run: AsyncTask<void, R>['run']; runOnce: AsyncTask<void, R>['runOnce'] };
export function createTask<A, R>(source: AsyncTask<A, R> | ((input: A) => Promise<R>)): { state: Accessor<TaskSnapshot<R>>; run: AsyncTask<A, R>['run']; runOnce: AsyncTask<A, R>['runOnce'] };
export function createTask<A, R>(source: AsyncTask<A, R> | ((input: A) => Promise<R>)) {
  const task = toTask(source);
  return { state: createObservable(task), run: task.run, runOnce: task.runOnce };
}
