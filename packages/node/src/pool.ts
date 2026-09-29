import { Worker as NodeWorker } from 'node:worker_threads';
import {
  WorkerPool,
  type SharedSpec,
  type TaskMap,
  type WorkerPoolConfig,
} from '@atolljs/core/sdk';
import { createNodeWorker } from './worker';

/**
 * WorkerPoolConfig for Node: workerUrl is replaced by a worker spec — a
 * bundled file path, a `new Worker(new URL('./x.worker.ts', import.meta.url))`
 * factory (webpack/esbuild detect the literal and emit the worker chunk), or
 * an explicit createWorker for full control.
 */
export interface NodePoolConfig<S extends SharedSpec = SharedSpec, T extends TaskMap = TaskMap>
  extends Omit<WorkerPoolConfig<S, T>, 'workerUrl' | 'createWorker'> {
  /** Bundled worker entry (e.g. dist/incidents.worker.js). */
  workerFile?: string;
  /**
   * Worker spec — the preferred form. A path/URL behaves like workerFile; a
   * factory may return a node:worker_threads Worker (auto-adapted) or a
   * DOM-style Worker (used as-is):
   *
   *   worker: () => new Worker(new URL('./x.worker.ts', import.meta.url))
   */
  worker?: string | URL | (() => Worker | NodeWorker);
  /** Worker factory; defaults to the node:worker_threads adapter. */
  createWorker?: () => Worker;
}

/** Adapts whatever the user spawned into the DOM Worker surface the pool needs. */
const toWorker = (w: Worker | NodeWorker): Worker =>
  w instanceof NodeWorker ? createNodeWorker(w) : w;

/**
 * Creates a WorkerPool backed by node:worker_threads. Identical to
 * `new WorkerPool` except workers default to `new NodeWorker(workerFile)`
 * wrapped in the EventTarget adapter — usable from any Node program, no
 * framework required:
 *
 *   const pool = createNodePool({ workerFile, sharedMemory, tasks });
 *   const pool = createNodePool({ worker: () => new Worker(new URL('./w.worker.ts', import.meta.url)), ... });
 */
export function createNodePool<S extends SharedSpec, T extends TaskMap>(
  config: NodePoolConfig<S, T>,
): WorkerPool<S, T> {
  const { workerFile, worker, createWorker, ...rest } = config;
  const file = workerFile ?? (typeof worker === 'function' ? undefined : worker);
  const factory =
    createWorker ??
    (typeof worker === 'function' ? () => toWorker(worker()) : undefined);
  return new WorkerPool({
    ...rest,
    createWorker:
      factory ??
      (() => {
        if (!file) {
          throw new Error('createNodePool requires worker, workerFile or createWorker.');
        }
        return createNodeWorker(file);
      }),
  });
}
