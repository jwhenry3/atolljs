// Framework-free pool registry — safe to import inside worker bundles.
// The main thread registers pools via MeshModule providers; @MeshTask
// dispatch looks them up here. In a worker context the registry stays empty,
// so decorated methods fall through to their real bodies.
import {
  WorkerPool,
  type SharedAccess,
  type SharedMemory,
  type SharedSpec,
  type TaskMap,
  type WorkerPoolConfig,
} from '@jwhenry123/mesh/sdk';
import { createNodePool } from '@jwhenry123/mesh-node';

export interface MeshPoolConfig<S extends SharedSpec = SharedSpec, T extends TaskMap = TaskMap>
  extends Omit<WorkerPoolConfig<S, T>, 'workerUrl' | 'createWorker' | 'sharedMemory'> {
  /** Registry name — @MeshTask({ pool: name }) targets it. Defaults to 'default'. */
  name?: string;
  /** Bundled worker entry (e.g. dist/incidents.worker.js). */
  workerFile?: string;
  /**
   * Worker factory — defaults to the node:worker_threads adapter on
   * workerFile. Prefer the bundler-detectable form so the config references
   * the TS source and webpack emits the chunk automatically:
   *   () => createNodeWorker(new Worker(new URL('./x.worker.ts', import.meta.url)))
   */
  createWorker?: () => Worker;
  /**
   * The contract this pool shares with its workers. Typed as SharedMemory<S>
   * rather than the WorkerPoolConfig field's `SharedMemory<S> & SharedAccess<S>`
   * so heterogeneous pool configs coexist — a bound contract's connector
   * surface can't satisfy the generic index signature SharedAccess<SharedSpec>
   * produces. Callers access fields through their own contract const anyway.
   */
  sharedMemory: SharedMemory<S>;
}

export interface MeshModuleOptions {
  /** Each pool may carry a different shared-memory spec and task map. */
  pools: MeshPoolConfig[];
}

export const getMeshPoolToken = (name = 'default') => `MESH_POOL:${name}`;

const registry = new Map<string, WorkerPool>();

export function registerMeshPool(name: string, pool: WorkerPool): void {
  registry.set(name, pool);
}

export function unregisterMeshPool(name: string): void {
  registry.delete(name);
}

export function getMeshPool(name = 'default'): WorkerPool | undefined {
  return registry.get(name);
}

export function buildMeshPool<S extends SharedSpec, T extends TaskMap>(
  config: MeshPoolConfig<S, T>,
): WorkerPool<S, T> {
  if (!config.createWorker && !config.workerFile) {
    throw new Error(`MeshPool "${config.name ?? 'default'}" requires workerFile or createWorker.`);
  }
  const { name: _name, workerFile, createWorker, sharedMemory, ...rest } = config;
  return createNodePool({
    ...rest,
    workerFile,
    createWorker,
    sharedMemory: sharedMemory as SharedMemory<S> & SharedAccess<S>,
  });
}
