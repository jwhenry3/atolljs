// Framework-free @AtollTask decorator — safe to import inside worker bundles.
// Method metadata lives in a WeakMap (no Reflect.metadata dependency —
// bundlers like esbuild don't emit design:paramtypes anyway).
import { isMainThread } from 'node:worker_threads';
import {
  TaskRegistry,
  type ServiceContract,
  type TaskContract,
} from '@atolljs/core/sdk';
import { getAtollPool } from './pools';

export interface AtollTaskMeta {
  contract: TaskContract;
  pool: string;
  /** The undecorated body — what actually executes inside the worker. */
  original: (...args: any[]) => any;
}

const metaStore = new WeakMap<object, Map<string | symbol, AtollTaskMeta>>();

export function getAtollTaskMeta(proto: object, key: string | symbol): AtollTaskMeta | undefined {
  return metaStore.get(proto)?.get(key);
}

// Worker-side: instances decorated handlers run against. registerAtollHandlers
// (via runAtollWorker) binds the DI-resolved instance here; until then calls
// delegate to a lazily-instantiated `new Cls()` — constructor params arrive
// undefined, so offloaded methods without a bound instance must not depend
// on injected members. Resolution happens at CALL time, so binding order
// never matters.
type Ctor = abstract new (...args: any[]) => object;

const workerInstances = new Map<Ctor, object>();

/** Binds the DI-resolved instance that a class's worker-side handlers run on. */
export function bindAtollWorkerInstance(ctor: Ctor, instance: object): void {
  workerInstances.set(ctor, instance);
}

const workerInstance = (ctor: Ctor) => {
  let inst = workerInstances.get(ctor);
  // The lazy `new ctor()` fallback only applies to dep-less classes — a class
  // with constructor params must be bound via bindAtollWorkerInstance (DI).
  if (!inst) workerInstances.set(ctor, (inst = new (ctor as new () => object)()));
  return inst;
};

/**
 * Moves a method's execution into a worker pool — usable on controllers and
 * services alike:
 *
 *   @Get('hotspots')
 *   @AtollTask({ pool: 'incidents' })
 *   hotspots(@Query('limit') limit?: string) { …scan shared memory… }
 *
 * Main thread: calling the method dispatches EXECUTE_TASK to the named pool
 * and resolves with the worker's result — the body never runs locally (falls
 * back to local execution only if no pool by that name is registered).
 *
 * Worker thread: when the module containing the class loads inside a worker,
 * the decorator auto-registers `ClassName.method` as a task handler bound to
 * a lazily-created instance — so the worker entry just imports the module.
 *
 * Overloads: `@AtollTask()` (auto taskId, 'default' pool),
 * `@AtollTask({ pool })`, `@AtollTask('task-id')`, or `@AtollTask(contract)` to
 * reuse a TaskContract's zod schemas. Args and results cross postMessage —
 * keep them structured-cloneable.
 */
export function AtollTask(): MethodDecorator;
export function AtollTask(options: { pool?: string }): MethodDecorator;
export function AtollTask(task: string | TaskContract, options?: { pool?: string }): MethodDecorator;
export function AtollTask(
  taskOrOpts?: string | TaskContract | { pool?: string },
  options: { pool?: string } = {},
): MethodDecorator {
  return (proto, key, descriptor: PropertyDescriptor) => {
    let contract: TaskContract;
    let poolName = options.pool ?? 'default';
    if (typeof taskOrOpts === 'string') {
      contract = { taskId: taskOrOpts };
    } else if (taskOrOpts && 'taskId' in taskOrOpts) {
      contract = taskOrOpts;
    } else {
      contract = { taskId: `${proto.constructor.name}.${String(key)}` };
      poolName = taskOrOpts?.pool ?? poolName;
    }

    const original = descriptor.value as (...args: any[]) => any;

    let map = metaStore.get(proto);
    if (!map) metaStore.set(proto, (map = new Map()));
    map.set(key, { contract, pool: poolName, original });

    // In a worker context, loading this module registers the real body —
    // the pool's EXECUTE_TASK dispatch finds it via TaskRegistry.
    if (!isMainThread) {
      const ctor = proto.constructor as Ctor;
      TaskRegistry.register(contract, (...args: unknown[]) =>
        original.apply(workerInstance(ctor), args),
      );
    }

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const pool = getAtollPool(poolName);
      return pool ? pool.runTask(contract, ...args) : original.apply(this, args);
    };
    return descriptor;
  };
}

/**
 * Binds a provider class to a worker pool — the NestJS adapter over the
 * framework-neutral dispatch. Two forms:
 *
 *   // contract-less: EVERY own prototype method becomes a task —
 *   // `ClassName.method` ids, like applying @AtollTask({ pool }) to each
 *   @Injectable()
 *   @AtollService({ pool: 'incidents' })
 *   export class IncidentsAnalytics {
 *     hotspots(limit = 10) { …scan shared memory… }
 *   }
 *
 *   // contract form: only methods declared in a ServiceContract are bound,
 *   // dispatching under the contract's taskIds (and schemas)
 *   @Injectable()
 *   @AtollService(someService, { pool: 'incidents' })
 *   export class IncidentsRpc {
 *     seedIncidents() { …scan shared memory… return ms; }
 *   }
 *
 * Main-thread calls route to the named pool; worker-side calls run the real
 * body on the DI-resolved instance. `pool` defaults to the service name in
 * the contract form. Contract form: methods not declared in the service are
 * untouched; service methods missing on the class are NOT bound (the worker
 * entry should compose `implementService` directly for those, or the call
 * surfaces as "handler not found" on dispatch — same as a missing @AtollTask
 * registration).
 */
export function AtollService(service: ServiceContract, options?: { pool?: string }): ClassDecorator;
export function AtollService(options: { pool: string }): ClassDecorator;
export function AtollService(
  serviceOrOpts: ServiceContract | { pool: string },
  options: { pool?: string } = {},
): ClassDecorator {
  // Contract-less form — every method dispatches to `pool` under
  // `ClassName.method` ids via the auto-taskId AtollTask overload.
  if (!('tasks' in serviceOrOpts)) {
    const { pool } = serviceOrOpts;
    return (ctor) => {
      const proto = ctor.prototype as object;
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor') continue;
        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        if (!descriptor || typeof descriptor.value !== 'function') continue;
        const applied = AtollTask({ pool })(proto, key, descriptor);
        if (applied) Object.defineProperty(proto, key, applied);
      }
    };
  }

  const service = serviceOrOpts;
  const pool = options.pool ?? service.name;
  return (ctor) => {
    const proto = ctor.prototype as object;
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      const contract = service.tasks[key];
      if (!contract) continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (!descriptor || typeof descriptor.value !== 'function') continue;
      const applied = AtollTask(contract, { pool })(proto, key, descriptor);
      if (applied) Object.defineProperty(proto, key, applied);
    }
  };
}
