import './workerBootstrap'; // side-effect: wires self.onmessage (guarded for main-thread import)
import { TaskRegistry } from './registry';
import { scoped } from '../log';
import type { ServiceMethod } from '../service';
import type { SharedMemory, SharedSpec } from '../contract/sharedMemory';

const workerLog = scoped('worker');

/**
 * One worker-exposed method: a plain function (siblings reachable via `this`)
 * or a {@link ServiceMethod} unit (`{ def, run }` — schemas enforced on the
 * wire).
 */
export type WorkerMethod = ((...args: any[]) => any) | ServiceMethod<any[], any>;
export type WorkerMethodMap = Record<string, WorkerMethod>;
export type WorkerServiceMap = Record<string, WorkerMethodMap>;

type ReservedKey = (typeof RESERVED_CLIENT_KEYS)[number];

/** Turns any reserved keys in M into `never`-typed members — a compile error. */
type NoReserved<M> = [Extract<keyof M, ReservedKey>] extends [never]
  ? M
  : M & { [K in Extract<keyof M, ReservedKey>]: never };

export interface DefineWorkerConfig<
  S extends SharedSpec,
  M extends WorkerMethodMap,
  Svc extends WorkerServiceMap,
> {
  /**
   * Optional — carried in the type so connectWorker can check the main-side
   * contract matches. Binding is global via workerBootstrap.
   */
  sharedMemory?: SharedMemory<S>;
  /** Flat methods → taskId = method name. */
  methods?: NoReserved<M>;
  /** Namespaced methods → taskId = `${service}.${method}`. */
  services?: NoReserved<Svc>;
}

export interface WorkerDefinition<
  S extends SharedSpec = SharedSpec,
  M extends WorkerMethodMap = {},
  Svc extends WorkerServiceMap = {},
> {
  readonly methods: M;
  readonly services: Svc;
  readonly sharedMemory?: SharedMemory<S>;
}

/**
 * Client-surface keys a worker method must not claim — a method named
 * `pool` or `then` would collide with {@link connectWorker}'s API (or make
 * the client look like a thenable).
 */
export const RESERVED_CLIENT_KEYS = ['start', 'terminate', 'pool', 'sharedMemory', 'then'] as const;

const isUnit = (x: unknown): x is ServiceMethod<any[], any> =>
  typeof x === 'object' && x !== null && 'run' in x;

const RESERVED = new Set<string>(RESERVED_CLIENT_KEYS);

/**
 * The worker-side half of the tRPC-style pair: the worker script owns the
 * runtime (importing this module wires `self.onmessage` via workerBootstrap)
 * and the method list — the main thread imports only `typeof` the returned
 * definition and drives it through a {@link connectWorker} Proxy client.
 *
 *   // incidents.worker.ts — the whole worker entry
 *   export const incidentsWorker = defineWorker({
 *     sharedMemory: incidentsMemory,
 *     methods: { seedIncidents, queryIncidents, computeMetrics },
 *   });
 *   export type IncidentsWorker = typeof incidentsWorker;
 *
 * Flat methods register under their own name; `services: { svc: { m } }`
 * registers `svc.m`. Plain functions are invoked with `this` bound to the
 * methods object (sibling calls); ServiceMethod units contribute their
 * `def` schemas (and a `def.taskId` override) and run bound to the unit.
 *
 * BOOTSTRAP ORDERING (Node): the `@jwhenry123/mesh-node/shim` import must
 * evaluate before this module — it binds `self = parentPort`, which
 * workerBootstrap needs at import time. Keep `import '@jwhenry123/mesh-node/shim'`
 * first in the worker entry.
 */
export function defineWorker<
  S extends SharedSpec,
  M extends WorkerMethodMap = {},
  Svc extends WorkerServiceMap = {},
>(config: DefineWorkerConfig<S, M, Svc>): WorkerDefinition<S, M, Svc> {
  const methods = (config.methods ?? {}) as M;
  const services = (config.services ?? {}) as Svc;

  let count = 0;
  const register = (taskId: string, name: string, method: WorkerMethod, thisArg: object) => {
    if (RESERVED.has(name)) {
      throw new Error(`defineWorker: "${name}" is reserved for the client API — rename the method`);
    }
    if (isUnit(method)) {
      const { def } = method;
      TaskRegistry.register(
        {
          taskId: def.taskId ?? taskId,
          ...(def.dataType ? { dataType: def.dataType } : {}),
          ...(def.argsSchema ? { argsSchema: def.argsSchema } : {}),
          ...(def.resultSchema ? { resultSchema: def.resultSchema } : {}),
        },
        method.run.bind(method),
      );
    } else {
      TaskRegistry.register({ taskId }, method.bind(thisArg));
    }
    count++;
  };

  for (const [name, method] of Object.entries(methods)) {
    register(name, name, method, methods);
  }
  for (const [service, serviceMethods] of Object.entries(services)) {
    if (RESERVED.has(service)) {
      throw new Error(`defineWorker: service name "${service}" is reserved for the client API — rename it`);
    }
    for (const [name, method] of Object.entries(serviceMethods)) {
      register(`${service}.${name}`, name, method, serviceMethods);
    }
  }

  workerLog.info(`worker defined — ${count} method(s)`);

  const definition: WorkerDefinition<S, M, Svc> = { methods, services };
  if (config.sharedMemory) {
    (definition as { sharedMemory?: SharedMemory<S> }).sharedMemory = config.sharedMemory;
  }
  return definition;
}
