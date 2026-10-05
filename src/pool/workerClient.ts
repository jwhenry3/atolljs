import type { ServiceMethod, TaskRunner } from '../service';
import type { SharedAccess, SharedMemory, SharedSpec } from '../contract/sharedMemory';
import type { MemoryConfig, Prettify } from '../contract/types';
import { WorkerPool, type RunOptions } from './workerPool';
import { DedicatedWorker } from './dedicatedWorker';
import type {
  WorkerDefinition,
  WorkerMethodMap,
} from '../worker/defineWorker';

/** Maps a worker method's declared type to its async client signature. */
type Sig<F> = F extends ServiceMethod<infer A extends any[], infer R>
  ? (...args: A) => Promise<R>
  : F extends { run: (...args: infer A extends any[]) => infer R }
    ? (...args: A) => Promise<Awaited<R>>
    : F extends (...args: infer A extends any[]) => infer R
      ? (...args: A) => Promise<Awaited<R>>
      : never;

/** Flat method map → client signatures. */
export type ClientMethods<M extends WorkerMethodMap> = { [K in keyof M]: Sig<M[K]> };

/**
 * The typed client surface a {@link WorkerDefinition} exposes: flat methods
 * plus one nested client per service namespace.
 */
export type WorkerMethods<W extends WorkerDefinition> = ClientMethods<W['methods']> & {
  [K in keyof W['services']]: W['services'][K] extends infer M extends WorkerMethodMap
    ? ClientMethods<M>
    : never;
} & {
  /** Per-call options — `client.with({ signal, timeout }).method(args)`. */
  with(options: RunOptions): WorkerMethods<W>;
};

const makeClientProxy = (
  path: string[],
  resolveRunner: () => TaskRunner,
  reserved?: Record<string, unknown>,
  options?: RunOptions,
): unknown => {
  // Cache nested proxies so `client.method` is referentially stable across
  // accesses — matters for memoized bindings (e.g. useTask's [source] deps).
  const children = new Map<string, unknown>();
  return new Proxy(() => {}, {
    get(_, prop) {
      // `then` and symbols return undefined so the proxy is never mistaken
      // for a thenable (await client, Promise.resolve(client), assimilation).
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      if (prop === 'with') {
        // client.with({ signal, timeout }) — same surface, calls dispatch
        // with RunOptions. Root-level only makes sense, but works anywhere.
        return (opts: RunOptions) =>
          makeClientProxy(path, resolveRunner, reserved, opts);
      }
      if (path.length === 0 && reserved && prop in reserved) {
        return Reflect.get(reserved, prop);
      }
      let child = children.get(prop);
      if (!child) {
        child = makeClientProxy([...path, prop], resolveRunner, reserved, options);
        children.set(prop, child);
      }
      return child;
    },
    apply(_, __, args: unknown[]) {
      const runner = resolveRunner();
      const contract = { taskId: path.join('.') };
      return runner.dispatch
        ? runner.dispatch(contract, args, options)
        : runner.runTask(contract, ...args);
    },
  });
};

/**
 * Typed Proxy over any {@link TaskRunner} (WorkerPool, SharedWorkerClient,
 * test stub). The path joins with '.', so `client.query(q)` dispatches
 * taskId "query" and `client.pricing.reprice(x)` dispatches
 * "pricing.reprice" — no runtime knowledge of the shape needed.
 */
export function workerClient<W extends WorkerDefinition>(
  runner: TaskRunner | (() => TaskRunner),
): WorkerMethods<W> {
  let resolved: TaskRunner | undefined;
  const resolveRunner =
    typeof runner === 'function'
      ? () => (resolved ??= runner())
      : () => runner;
  return makeClientProxy([], resolveRunner) as WorkerMethods<W>;
}

export interface ConnectWorkerConfig<S extends SharedSpec> {
  /** Omit for a message-only pool — the SharedArrayBuffer check is skipped. */
  sharedMemory?: SharedMemory<S> & Prettify<SharedAccess<S>>;
  /**
   * Ship an existing SharedArrayBuffer to every worker instead of
   * allocating one — e.g. `sharedBuffer: anotherPool.sharedBuffer`, or a
   * bound contract's `contract.buffer` inside a worker shell. A thunk is
   * resolved once at pool construction.
   */
  sharedBuffer?: SharedArrayBuffer | (() => SharedArrayBuffer | undefined);
  /**
   * Bundler-detectable factory `() => new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`,
   * or a URL.
   */
  worker: (() => Worker) | URL;
  /**
   * How many workers this client needs. `1` (the default) is a single
   * dedicated worker with no pool: calls post straight to it, no queue or
   * scheduler. `N > 1` builds a pool that spreads separate calls across N
   * workers; `'auto'` sizes it to `navigator.hardwareConcurrency ?? 4`.
   */
  workers?: number | 'auto';
  /** @deprecated Use `workers`. Read only when `workers` is absent. */
  poolSize?: number | 'auto';
  /** Display label for devtools/dashboards — falls back to a generated id. */
  name?: string;
  memory?: MemoryConfig;
  /** Pool only: max in-flight tasks per worker (default 1); excess calls queue FIFO. */
  concurrency?: number;
  /** Pool only: max queued calls (default Infinity); a full queue rejects with PoolQueueFullError. */
  maxQueue?: number;
  /** Default true — a crashed worker is replaced and its in-flight calls reject. */
  respawn?: boolean;
  /** Default per-call timeout ms (`client.with({ timeout })` overrides). */
  taskTimeout?: number;
  /** Default true: pool spawns on first method call (or start()). False spawns immediately. */
  lazy?: boolean;
}

/** What a client runs on: a pool (`workers > 1`) or one dedicated worker. */
export type WorkerRunner<S extends SharedSpec = SharedSpec> = WorkerPool<S> | DedicatedWorker<S>;

/** Resolve a `workers` count: `'auto'` is one per core (4 when unknown). */
export const resolveWorkerCount = (n: number | 'auto' | undefined): number =>
  n === 'auto'
    ? typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency ?? 4)
      : 4
    : Math.max(1, Math.floor(n ?? 1));

/** A typed worker client plus lifecycle controls. */
export type WorkerClient<W extends WorkerDefinition, S extends SharedSpec> = WorkerMethods<W> & {
  /** Spawn the worker(s) now (idempotent). */
  start(): void;
  /** Terminate the worker(s); the next method call re-spawns. */
  terminate(): void;
  /**
   * The runner once spawned: a `DedicatedWorker` for `workers: 1`, a
   * `WorkerPool` otherwise. Both expose `stats()`, `close()`, `terminate()`,
   * `workers`, `sharedBuffer` and `poolId`.
   */
  readonly pool: WorkerRunner<S> | null;
  readonly sharedMemory: ConnectWorkerConfig<S>['sharedMemory'] | undefined;
};

/**
 * One-line worker hookup for the main thread — the WorkerPool boilerplate
 * (worker factory, shared memory, sizing) collapses into the client itself:
 *
 *   import type { IncidentsWorker } from './worker/incidents.worker';
 *
 *   export const incidents = connectWorker<IncidentsWorker>({
 *     sharedMemory: incidentsMemory,
 *     worker: () => new Worker(new URL('./worker/incidents.worker.ts', import.meta.url), { type: 'module' }),
 *     workers: 3,                         // omit for one dedicated worker
 *   });
 *
 *   await incidents.queryIncidents(q);   // typed dispatch
 *   incidents.terminate();               // next call lazily re-spawns
 *
 * `workers` states what the work needs and the client picks the runner:
 * 1 (default) → a `DedicatedWorker`, no pool; more → a `WorkerPool`.
 *
 * Lazy by default: no Worker is touched until the first method call (or
 * `start()`), so importing the client is SSR-safe.
 */
export function connectWorker<
  W extends WorkerDefinition,
  S extends SharedSpec = W extends WorkerDefinition<infer X> ? X : SharedSpec,
>(config: ConnectWorkerConfig<S>): WorkerClient<W, S> {
  let pool: WorkerRunner<S> | null = null;
  const spawn = (): WorkerRunner<S> => {
    if (pool) return pool;
    const count = resolveWorkerCount(config.workers ?? config.poolSize);
    const base = {
      sharedMemory: config.sharedMemory,
      sharedBuffer: config.sharedBuffer,
      createWorker:
        typeof config.worker === 'function'
          ? config.worker
          : () => new Worker(config.worker as URL, { type: 'module' }),
      name: config.name,
      memory: config.memory,
      respawn: config.respawn,
      taskTimeout: config.taskTimeout,
    };
    pool =
      count === 1
        ? new DedicatedWorker<S>(base)
        : new WorkerPool<S>({
            ...base,
            poolSize: count,
            concurrency: config.concurrency,
            maxQueue: config.maxQueue,
          });
    return pool;
  };

  if (config.lazy === false) spawn();

  const reserved = {
    start: () => {
      spawn();
    },
    terminate: () => {
      pool?.terminate();
      pool = null;
    },
    get pool() {
      return pool;
    },
    get sharedMemory() {
      return config.sharedMemory;
    },
  };

  return makeClientProxy([], spawn, reserved) as WorkerClient<W, S>;
}
