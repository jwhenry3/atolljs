import type { ServiceMethod, TaskRunner } from '../service';
import type { SharedAccess, SharedMemory, SharedSpec } from '../contract/sharedMemory';
import type { MemoryConfig, Prettify } from '../contract/types';
import { WorkerPool, type RunOptions } from './workerPool';
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
  poolSize?: number | 'auto';
  /** Display label for devtools/dashboards — falls back to a generated id. */
  name?: string;
  memory?: MemoryConfig;
  /** Max in-flight tasks per worker (default 1); excess calls queue FIFO. */
  concurrency?: number;
  /** Max queued calls (default Infinity); a full queue rejects with PoolQueueFullError. */
  maxQueue?: number;
  /** Default true — a crashed worker is replaced and its in-flight calls reject. */
  respawn?: boolean;
  /** Default per-call timeout ms (`client.with({ timeout })` overrides). */
  taskTimeout?: number;
  /** Default true: pool spawns on first method call (or start()). False spawns immediately. */
  lazy?: boolean;
}

/** A typed worker client plus pool lifecycle controls. */
export type WorkerClient<W extends WorkerDefinition, S extends SharedSpec> = WorkerMethods<W> & {
  /** Spawn the pool now (idempotent). */
  start(): void;
  /** Terminate the pool; the next method call re-spawns it. */
  terminate(): void;
  readonly pool: WorkerPool<S> | null;
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
 *     poolSize: 1,
 *   });
 *
 *   await incidents.queryIncidents(q);   // typed dispatch to the pool
 *   incidents.terminate();               // next call lazily re-spawns
 *
 * Lazy by default: no Worker is touched until the first method call (or
 * `start()`), so importing the client is SSR-safe.
 */
export function connectWorker<
  W extends WorkerDefinition,
  S extends SharedSpec = W extends WorkerDefinition<infer X> ? X : SharedSpec,
>(config: ConnectWorkerConfig<S>): WorkerClient<W, S> {
  let pool: WorkerPool<S> | null = null;
  const spawn = (): WorkerPool<S> =>
    (pool ??= new WorkerPool<S>({
      sharedMemory: config.sharedMemory,
      sharedBuffer: config.sharedBuffer,
      createWorker:
        typeof config.worker === 'function'
          ? config.worker
          : () => new Worker(config.worker as URL, { type: 'module' }),
      poolSize: config.poolSize,
      name: config.name,
      memory: config.memory,
      concurrency: config.concurrency,
      maxQueue: config.maxQueue,
      respawn: config.respawn,
      taskTimeout: config.taskTimeout,
    }));

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
