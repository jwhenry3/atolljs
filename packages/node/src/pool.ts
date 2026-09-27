import {
  WorkerPool,
  type SharedSpec,
  type TaskMap,
  type WorkerPoolConfig,
} from '@jwhenry123/mesh/sdk';
import { createNodeWorker } from './worker';

/**
 * WorkerPoolConfig for Node: workerUrl is replaced by a bundled worker file
 * path (or an explicit createWorker factory — e.g. the webpack-detectable
 * `new Worker(new URL('./x.worker.ts', import.meta.url))` form).
 */
export interface NodePoolConfig<S extends SharedSpec = SharedSpec, T extends TaskMap = TaskMap>
  extends Omit<WorkerPoolConfig<S, T>, 'workerUrl' | 'createWorker'> {
  /** Bundled worker entry (e.g. dist/incidents.worker.js). */
  workerFile?: string;
  /** Worker factory; defaults to the node:worker_threads adapter. */
  createWorker?: () => Worker;
}

/**
 * Creates a WorkerPool backed by node:worker_threads. Identical to
 * `new WorkerPool` except workers default to `new NodeWorker(workerFile)`
 * wrapped in the EventTarget adapter — usable from any Node program, no
 * framework required:
 *
 *   const pool = createNodePool({ workerFile, sharedMemory, tasks });
 */
export function createNodePool<S extends SharedSpec, T extends TaskMap>(
  config: NodePoolConfig<S, T>,
): WorkerPool<S, T> {
  const { workerFile, createWorker, ...rest } = config;
  return new WorkerPool({
    ...rest,
    createWorker:
      createWorker ??
      (() => {
        if (!workerFile) {
          throw new Error('createNodePool requires workerFile or createWorker.');
        }
        return createNodeWorker(workerFile);
      }),
  });
}
