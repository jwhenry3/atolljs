import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import { observe, toTask } from '@atolljs/core';
import type { AsyncTask, ObservableValue, PathConnector, SharedMemory, SharedSpec, SpecPath, SliceOptions, TaskSnapshot } from '@atolljs/core';

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
export function sharedValue<S extends SharedSpec, K extends SpecPath<S>>(memory: SharedMemory<S>, key: K): Signal<(PathConnector<S, K> extends { read(): infer T } ? T : never) | undefined>;
export function sharedValue<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: PathConnector<S, K> extends { read(): infer T } ? T : never) => Sel,
  options?: SliceOptions<Sel>
): Signal<Sel | undefined>;
export function sharedValue<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: never) => Sel,
  options?: SliceOptions<Sel>
) {
  return observableSignal(observe(memory, key, select as never, options as never));
}

/** Bind an AsyncTask or plain async fn (via toTask): `{ state }` is a Signal of its snapshot; `run`/`runOnce` trigger it. */
export function taskState<R>(source: AsyncTask<void, R> | (() => Promise<R>)): { state: Signal<TaskSnapshot<R>>; run: AsyncTask<void, R>['run']; runOnce: AsyncTask<void, R>['runOnce'] };
export function taskState<A, R>(source: AsyncTask<A, R> | ((input: A) => Promise<R>)): { state: Signal<TaskSnapshot<R>>; run: AsyncTask<A, R>['run']; runOnce: AsyncTask<A, R>['runOnce'] };
export function taskState<A, R>(source: AsyncTask<A, R> | ((input: A) => Promise<R>)) {
  const task = toTask(source);
  return { state: observableSignal(task), run: task.run, runOnce: task.runOnce };
}

export { provideAtoll, injectAtollPool, getAtollPoolToken } from './provideAtoll';
export type { AtollPoolDeclaration, AtollPoolSpec, AtollProvideOptions, AtollFeature } from './provideAtoll';
export { AtollModule, InjectAtollPool } from './atollModule';
export type { AtollModuleAsyncOptions, AtollPoolAsyncOptions, AtollPoolAsyncDecl } from './atollModule';
