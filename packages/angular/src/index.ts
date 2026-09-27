import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import { observe } from '@jwhenry123/mesh/sdk';
import type { AsyncTask, ObservableValue, SharedAccess, SharedMemory, SharedSpec, SliceOptions } from '@jwhenry123/mesh/sdk';

function unhook(stop: () => void) {
  inject(DestroyRef, { optional: true })?.onDestroy(stop);
}

/**
 * Wrap any sdk ObservableValue in a Signal. Call in an injection context
 * (component field initializer or constructor) so the subscription is
 * released on destroy; without one the subscription lives forever.
 */
export function observableSignal<T>(source: ObservableValue<T>): Signal<T> {
  const value = signal<T>(source.get());
  unhook(source.subscribe((v) => value.set(v)));
  return value.asReadonly();
}

/**
 * Bind one shared-memory field to a Signal. Stays `undefined` until the
 * contract is bound and the field written; updates on every write.
 */
export function sharedValue<S extends SharedSpec, K extends keyof S>(memory: SharedMemory<S>, key: K): Signal<(SharedAccess<S>[K] extends { read(): infer T } ? T : never) | undefined>;
export function sharedValue<S extends SharedSpec, K extends keyof S, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: SharedAccess<S>[K] extends { read(): infer T } ? T : never) => Sel,
  options?: SliceOptions<Sel>
): Signal<Sel | undefined>;
export function sharedValue<S extends SharedSpec, K extends keyof S, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: never) => Sel,
  options?: SliceOptions<Sel>
) {
  return observableSignal(observe(memory, key, select as never, options as never));
}

/** Bind an AsyncTask: `{ state }` is a Signal of its snapshot; `run`/`runOnce` trigger it. */
export function taskState<A, R>(task: AsyncTask<A, R>) {
  return { state: observableSignal(task), run: task.run, runOnce: task.runOnce };
}

export { provideMesh, injectMeshPool, getMeshPoolToken } from './provideMesh';
export type { MeshPoolDeclaration, MeshFeature } from './provideMesh';
