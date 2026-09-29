// Framework-free pool registry — safe to import inside worker bundles.
// The main thread registers pools via AtollModule providers; @AtollTask
// dispatch looks them up here. In a worker context the registry stays empty,
// so decorated methods fall through to their real bodies.
import type { Worker as NodeWorker } from 'node:worker_threads';
import {
  WorkerPool,
  type SharedAccess,
  type SharedMemory,
  type SharedSpec,
  type TaskMap,
  type WorkerPoolConfig,
} from '@atolljs/core';
import { createNodePool } from '@atolljs/node';

export interface AtollPoolConfig<S extends SharedSpec = SharedSpec, T extends TaskMap = TaskMap>
  extends Omit<WorkerPoolConfig<S, T>, 'workerUrl' | 'createWorker' | 'sharedMemory'> {
  /** Registry name — @AtollTask({ pool: name }) targets it. Defaults to 'default'. */
  name?: string;
  /** Bundled worker entry (e.g. dist/incidents.worker.js). */
  workerFile?: string;
  /**
   * Worker spec — the preferred form. A path/URL behaves like workerFile; a
   * factory may return a node:worker_threads Worker (auto-adapted) or a
   * DOM-style Worker — the bundler-detectable literal stays in app code while
   * the adapter wrapping disappears:
   *   worker: () => new Worker(new URL('./x.worker.ts', import.meta.url))
   */
  worker?: string | URL | (() => Worker | NodeWorker);
  /**
   * Worker factory — defaults to the node:worker_threads adapter on
   * workerFile/worker.
   */
  createWorker?: () => Worker;
  /**
   * The contract this pool shares with its workers. Typed as SharedMemory<S>
   * rather than the WorkerPoolConfig field's `SharedMemory<S> & SharedAccess<S>`
   * so heterogeneous pool configs coexist — a bound contract's connector
   * surface can't satisfy the generic index signature SharedAccess<SharedSpec>
   * produces. Callers access fields through their own contract const anyway.
   * Omit for message-only pools — the SharedArrayBuffer check is skipped.
   */
  sharedMemory?: SharedMemory<S>;
}

export interface AtollModuleOptions {
  /** Each pool may carry a different shared-memory spec and task map. */
  pools?: AtollPoolConfig[];
}

export const getAtollPoolToken = (name = 'default') => `ATOLL_POOL:${name}`;

const registry = new Map<string, WorkerPool>();

export function registerAtollPool(name: string, pool: WorkerPool): void {
  registry.set(name, pool);
}

export function unregisterAtollPool(name: string): void {
  registry.delete(name);
}

export function getAtollPool(name = 'default'): WorkerPool | undefined {
  return registry.get(name);
}

export function buildAtollPool<S extends SharedSpec, T extends TaskMap>(
  config: AtollPoolConfig<S, T>,
): WorkerPool<S, T> {
  if (!config.createWorker && !config.workerFile && !config.worker) {
    throw new Error(`AtollPool "${config.name ?? 'default'}" requires worker, workerFile or createWorker.`);
  }
  const { name: _name, workerFile, worker, createWorker, sharedMemory, ...rest } = config;
  return createNodePool({
    ...rest,
    workerFile,
    worker,
    createWorker,
    ...(sharedMemory
      ? { sharedMemory: sharedMemory as SharedMemory<S> & SharedAccess<S> }
      : {}),
  });
}
