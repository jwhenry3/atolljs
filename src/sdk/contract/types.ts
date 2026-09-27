import type { SharedAccess, SharedMemory, SharedSpec } from './sharedMemory';

export type ViewType = 'Int32' | 'Float64' | 'BigInt64' | 'Uint8';

/**
 * Minimal validation contract — compatible with zod schemas (`z.object(...)`)
 * and any validator exposing `parse`.
 */
export interface Schema<T> {
  parse(value: unknown): T;
}

export type Logger = (...args: unknown[]) => void;

/**
 * Flattens a computed object type into its concrete shape so IDE hovers show
 * `{ id: number; site: string }` instead of the mapped-type machinery that
 * produced it. Applied to synthetic types (e.g. list records); user-named
 * types keep their names since the name is the better display.
 */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export interface MemoryConfig {
  initialPages?: number; // 1 page = 64KB
  maximumPages?: number; // default 16384 (1GB)
  growthFactor?: number;
}

export interface WorkerPoolConfig<S extends SharedSpec = SharedSpec, T extends TaskMap = TaskMap> {
  /** Worker entry as a URL — e.g. `new URL('./worker.ts', import.meta.url)`. */
  workerUrl?: URL;
  /**
   * Bundler-detectable worker factory. Most bundlers only emit a worker chunk
   * when the entry appears inline, so prefer this form:
   * `createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
   * One of `workerUrl` / `createWorker` is required.
   */
  createWorker?: () => Worker;
  sharedMemory: SharedMemory<S> & Prettify<SharedAccess<S>>;
  /** Worker count — a number, or 'auto' (the default) for navigator.hardwareConcurrency ?? 4. */
  poolSize?: number | 'auto';
  memory?: MemoryConfig;
  /**
   * Named task contracts. Keys become first-class pool methods:
   * `tasks: { queryIncidents: QueryIncidents }` → `pool.queryIncidents(q)`.
   */
  tasks?: T;
}

export interface SharedWorkerConfig<S extends SharedSpec = SharedSpec, T extends TaskMap = TaskMap> {
  /** SharedWorker entry as a URL — e.g. `new URL('./worker.ts', import.meta.url)`. */
  workerUrl?: URL;
  /**
   * Bundler-detectable factory — `createWorker: () => new SharedWorker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
   * One of `workerUrl` / `createWorker` / `port` is required.
   */
  createWorker?: () => SharedWorker;
  /** A pre-opened MessagePort — tests, or hosts that forward a port another way. */
  port?: MessagePort;
  sharedMemory: SharedMemory<S> & Prettify<SharedAccess<S>>;
  /**
   * Buffer sizing hint sent on connect — the first connected client wins;
   * the shared worker allocates the buffer once and shares it with everyone.
   */
  memory?: MemoryConfig;
  /**
   * Named task contracts. Keys become first-class client methods:
   * `tasks: { queryIncidents: QueryIncidents }` → `client.queryIncidents(q)`.
   */
  tasks?: T;
  /** Connect handshake timeout in ms (default 10000). */
  connectTimeoutMs?: number;
}

export interface TaskContract<Args extends any[] = any[], Result = any> {
  taskId: string;
  dataType?: ViewType; // element datatype of the shared-memory region this task operates on (omit for structured fields)
  argsSchema?: Schema<Args>; // validates args as they cross the thread boundary
  resultSchema?: Schema<Result>; // validates the handler's return value
}

/** A map of named task contracts — keys become first-class WorkerPool methods. */
export type TaskMap = Record<string, TaskContract<any[], any>>;

/**
 * The method surface a WorkerPool exposes for a task map: each contract
 * becomes a function with its declared args returning `Promise<Result>`.
 */
export type PoolTasks<T extends TaskMap> = {
  [K in keyof T]: T[K] extends TaskContract<infer Args, infer Result>
    ? (...args: Args) => Promise<Result>
    : never;
};

export interface TaskMessage {
  taskId: string;
  args?: any[];
  memoryOffset?: number;
  byteLength?: number;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  result?: any;
  error?: string;
}
