// Framework-neutral RPC layer. A service contract is declared ONCE and
// imported by both threads: the worker binds handlers via implementService
// (higher-order functions, no decorators), and the main thread dispatches
// through createClient or by passing service.tasks straight into a
// WorkerPool/SharedWorker config. Method names and wire ids can never drift
// because every surface derives from the same object.
import type { Schema, TaskContract, ViewType } from './contract/types';
import { scoped } from './log';
import { TaskRegistry } from './worker/registry';

const svcLog = scoped('service');

/**
 * One RPC method's declaration. Identical fields to {@link TaskContract}
 * except `taskId` is optional — when omitted the wire id is derived as
 * `${serviceName}.${methodName}` so it can't drift between threads.
 *
 * Most methods need no wrapper — write the object inline and defineService
 * infers Args/Result from the schemas:
 *
 *   seedIncidents: { resultSchema: z.number() },          // → () => number
 *   queryIncidents: { argsSchema, resultSchema },          // → (q) => Result
 *
 * Use {@link rpc} only to declare types a method's schemas can't carry —
 * e.g. typed args with no validation: `rpc<[QueryArgs], QueryResult>()`.
 */
export interface RpcMethodDef<Args extends any[] = any[], Result = any> {
  /** Explicit wire id — only needed to interop with pre-existing taskIds. */
  taskId?: string;
  /** Element datatype of the shared-memory region this method operates on. */
  dataType?: ViewType;
  /** Validates args as they cross the thread boundary. */
  argsSchema?: Schema<Args>;
  /** Validates the handler's return value. */
  resultSchema?: Schema<Result>;
}

/**
 * Explicit type carrier for method declarations — an identity function.
 * Needed only when schemas are absent or don't express the full signature;
 * schema-typed methods infer automatically inside defineService.
 */
export function rpc<Args extends any[] = any[], Result = any>(
  def: RpcMethodDef<Args, Result> = {},
): RpcMethodDef<Args, Result> {
  return def;
}

export type RpcMethodMap = Record<string, RpcMethodDef<any[], any>>;

/**
 * Resolves a method declaration to its TaskContract type. Schemas win when
 * present (argsSchema+resultSchema → full signature; resultSchema alone →
 * a no-arg method); an rpc<A,R>() declaration's type args carry the rest.
 */
type MethodContract<D> =
  D extends { argsSchema: Schema<infer A extends any[]> }
    ? D extends { resultSchema: Schema<infer R> }
      ? TaskContract<A, R>
      : TaskContract<A, any>
    : D extends { resultSchema: Schema<infer R> }
      ? TaskContract<[], R>
      : D extends RpcMethodDef<infer A extends any[], infer R>
        ? TaskContract<A, R>
        : TaskContract<any[], any>;

type MethodsToContracts<M extends RpcMethodMap> = {
  [K in keyof M]: MethodContract<M[K]>;
};

/**
 * A named bundle of RPC method contracts shared by both threads. `tasks` is
 * a fully-typed {@link TaskMap} — hand it to `WorkerPool`/`SharedWorker`
 * config or iterate it for registration.
 */
export interface ServiceContract<M extends RpcMethodMap = RpcMethodMap> {
  readonly name: string;
  readonly tasks: MethodsToContracts<M>;
}

/**
 * Declares a worker service's RPC surface. The same object is imported by
 * the worker entry (for `implementService`) and the main thread (for
 * `createClient` / pool config):
 *
 *   export const incidentsService = defineService('incidents', {
 *     seedIncidents: { resultSchema: z.number() },
 *     queryIncidents: {
 *       argsSchema: z.tuple([queryArgsSchema]),
 *       resultSchema: queryResultSchema,
 *     },
 *   });
 */
export function defineService<M extends RpcMethodMap>(
  name: string,
  methods: M,
): ServiceContract<M> {
  const tasks = {} as Record<string, TaskContract>;
  for (const [method, def] of Object.entries(methods)) {
    tasks[method] = {
      taskId: def.taskId ?? `${name}.${method}`,
      ...(def.dataType ? { dataType: def.dataType } : {}),
      ...(def.argsSchema ? { argsSchema: def.argsSchema } : {}),
      ...(def.resultSchema ? { resultSchema: def.resultSchema } : {}),
    };
  }
  return { name, tasks: tasks as MethodsToContracts<M> };
}

/** The handler signatures a service implementation must provide. */
export type ServiceHandlers<M extends RpcMethodMap> = {
  [K in keyof M]: MethodContract<M[K]> extends TaskContract<infer A, infer R>
    ? (...args: A) => R | Promise<R>
    : never;
};

/**
 * A service contract bound to handler implementations — the worker-side
 * "service" that owns the RPC methods. Registration happens eagerly inside
 * {@link implementService}; the returned handle is for composition/testing.
 */
export interface ServiceImpl<M extends RpcMethodMap = RpcMethodMap> {
  readonly service: ServiceContract<M>;
  readonly handlers: ServiceHandlers<M>;
}

/**
 * Binds a service contract to handler functions and registers every method
 * with the {@link TaskRegistry} — the worker-side half of the contract:
 *
 *   export const incidentsImpl = implementService(incidentsService, {
 *     seedIncidents: () => { …; return ms; },
 *     queryIncidents: (q) => { …; return page; },
 *   });
 *
 * Missing methods throw at bind time (a silent omission would surface as a
 * runtime "handler not found" on the far thread). Handlers are invoked with
 * `this` bound to the handlers object, so methods may call siblings via
 * `this`. When `handlers` is a class instance (e.g. a DI-resolved provider
 * whose methods match the service surface), binding preserves its `this`.
 */
export function implementService<M extends RpcMethodMap>(
  service: ServiceContract<M>,
  handlers: ServiceHandlers<M>,
): ServiceImpl<M> {
  const missing = Object.keys(service.tasks).filter(
    (k) => typeof handlers[k] !== 'function',
  );
  if (missing.length > 0) {
    throw new Error(
      `implementService("${service.name}"): missing handlers for ${missing.join(', ')}`,
    );
  }
  for (const [method, contract] of Object.entries(service.tasks)) {
    TaskRegistry.register(
      contract,
      (handlers[method] as (...args: any[]) => any).bind(handlers),
    );
  }
  svcLog.info(
    `service "${service.name}" implemented — ${Object.keys(service.tasks).join(', ')}`,
  );
  return { service, handlers };
}

/** Anything that can dispatch a TaskContract — WorkerPool, SharedWorkerClient. */
export interface TaskRunner {
  runTask<Args extends any[], Result>(
    contract: TaskContract<Args, Result>,
    ...args: Args
  ): Promise<Result>;
}

/** The callable RPC surface a service client exposes. */
export type ServiceClient<M extends RpcMethodMap> = {
  [K in keyof M]: MethodContract<M[K]> extends TaskContract<infer A, infer R>
    ? (...args: A) => Promise<R>
    : never;
};

/**
 * The main-thread half of a service contract: a typed proxy that turns
 * `client.seedIncidents()` into `runner.runTask(contract)`. Works over any
 * {@link TaskRunner} — a WorkerPool, a SharedWorkerClient, or a test stub.
 */
export function createClient<M extends RpcMethodMap>(
  service: ServiceContract<M>,
  runner: TaskRunner,
): ServiceClient<M> {
  const client = {} as Record<string, unknown>;
  for (const [method, contract] of Object.entries(service.tasks)) {
    client[method] = (...args: unknown[]) =>
      runner.runTask(contract as TaskContract<any[], any>, ...(args as any[]));
  }
  return client as ServiceClient<M>;
}
