// Framework-free @MeshTask decorator — safe to import inside worker bundles.
// Method metadata lives in a WeakMap (no Reflect.metadata dependency —
// bundlers like esbuild don't emit design:paramtypes anyway).
import { isMainThread } from 'node:worker_threads';
import { TaskRegistry, type TaskContract } from '@jwhenry123/mesh/sdk';
import { getMeshPool } from './pools';

export interface MeshTaskMeta {
  contract: TaskContract;
  pool: string;
  /** The undecorated body — what actually executes inside the worker. */
  original: (...args: any[]) => any;
}

const metaStore = new WeakMap<object, Map<string | symbol, MeshTaskMeta>>();

export function getMeshTaskMeta(proto: object, key: string | symbol): MeshTaskMeta | undefined {
  return metaStore.get(proto)?.get(key);
}

// Worker-side: lazily-instantiated instances of decorated classes. Handlers
// run against `new Cls()` — constructor params arrive undefined, so offloaded
// methods must not depend on injected members; they get their inputs from
// args plus shared memory.
const workerInstances = new Map<new () => object, object>();
const workerInstance = (ctor: new () => object) => {
  let inst = workerInstances.get(ctor);
  if (!inst) workerInstances.set(ctor, (inst = new ctor()));
  return inst;
};

/**
 * Moves a method's execution into a worker pool — usable on controllers and
 * services alike:
 *
 *   @Get('hotspots')
 *   @MeshTask({ pool: 'incidents' })
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
 * Overloads: `@MeshTask()` (auto taskId, 'default' pool),
 * `@MeshTask({ pool })`, `@MeshTask('task-id')`, or `@MeshTask(contract)` to
 * reuse a TaskContract's zod schemas. Args and results cross postMessage —
 * keep them structured-cloneable.
 */
export function MeshTask(): MethodDecorator;
export function MeshTask(options: { pool?: string }): MethodDecorator;
export function MeshTask(task: string | TaskContract, options?: { pool?: string }): MethodDecorator;
export function MeshTask(
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
      const ctor = proto.constructor as new () => object;
      TaskRegistry.register(contract, (...args: unknown[]) =>
        original.apply(workerInstance(ctor), args),
      );
    }

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const pool = getMeshPool(poolName);
      return pool ? pool.runTask(contract, ...args) : original.apply(this, args);
    };
    return descriptor;
  };
}
