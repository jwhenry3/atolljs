import { createSignal, onCleanup, type Accessor } from 'solid-js';
import { observe } from '@jwhenry123/mesh/sdk';
import type { AsyncTask, ObservableValue, SharedAccess, SharedMemory, SharedSpec, SliceOptions } from '@jwhenry123/mesh/sdk';

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
export function createSharedValue<S extends SharedSpec, K extends keyof S>(memory: SharedMemory<S>, key: K): Accessor<(SharedAccess<S>[K] extends { read(): infer T } ? T : never) | undefined>;
export function createSharedValue<S extends SharedSpec, K extends keyof S, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: SharedAccess<S>[K] extends { read(): infer T } ? T : never) => Sel,
  options?: SliceOptions<Sel>
): Accessor<Sel | undefined>;
export function createSharedValue<S extends SharedSpec, K extends keyof S, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: never) => Sel,
  options?: SliceOptions<Sel>
) {
  return createObservable(observe(memory, key, select as never, options as never));
}

/** Bind an AsyncTask: `{ state }` is an Accessor of its snapshot; `run`/`runOnce` trigger it. */
export function createTask<A, R>(task: AsyncTask<A, R>) {
  return { state: createObservable(task), run: task.run, runOnce: task.runOnce };
}
