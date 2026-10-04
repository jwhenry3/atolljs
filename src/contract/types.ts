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

/**
 * Runtime handle for a memory-persistence adapter — e.g. the Redis adapter
 * in '@atolljs/node/redis'. The adapter mirrors the bound contract's field
 * regions to external storage; the buffer stays the synchronous source of
 * truth.
 */
export interface MemoryPersistence {
  /** Resolves when initial state has been restored into the local buffer. */
  readonly ready?: Promise<unknown>;
  /** Push dirty fields now — most adapters also flush on an interval. */
  flush?(): Promise<unknown>;
  /** Final flush + release external resources. Invoked by pool.terminate(). */
  stop(): void | Promise<void>;
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
  /**
   * The contract the pool binds and hands to each worker via INIT_MEMORY.
   * Omit for message-only workers — the SharedArrayBuffer/isolation check is
   * skipped and workers receive a plain `{ type: 'INIT' }` handshake.
   */
  sharedMemory?: SharedMemory<S> & Prettify<SharedAccess<S>>;
  /**
   * Persistence adapter for `sharedMemory` — invoked with the contract right
   * after the pool binds it, and its `stop()` runs on `terminate()`.
   * `redisMemoryAdapter(client)` from '@atolljs/node/redis' produces one.
   */
  persistence?: (memory: SharedMemory<S>) => MemoryPersistence | undefined;
  /** Worker count — a number, or 'auto' (the default) for navigator.hardwareConcurrency ?? 4. */
  poolSize?: number | 'auto';
  /** Display label for devtools/dashboards — falls back to a generated id. */
  name?: string;
  memory?: MemoryConfig;
  /** Max in-flight tasks per worker (default 1); excess tasks queue FIFO. */
  concurrency?: number;
  /** Max queued tasks (default Infinity); a full queue rejects with PoolQueueFullError. */
  maxQueue?: number;
  /** Default true — a worker 'error' rejects its in-flight tasks and spawns a replacement. */
  respawn?: boolean;
  /**
   * Default per-task timeout in ms (per-call `options.timeout` overrides).
   * The timer starts at enqueue, so it bounds queue-wait + execution together.
   */
  taskTimeout?: number;
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
