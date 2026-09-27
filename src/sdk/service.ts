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

/**
 * One method's whole unit — the pattern for one-file-per-task modules. The
 * file's top-level export satisfies this interface: `def` is the wire
 * declaration {@link defineService} composes, `run` is the worker-side
 * implementation {@link implementService} registers. Both entry points
 * accept the unit directly and unwrap the part they need:
 *
 *   // service/seedIncidents.ts — one file, the whole stack
 *   export const seedIncidents = {
 *     def: { resultSchema: z.number() },
 *     run() { …; return ms; },
 *   } satisfies ServiceMethod<[], number>;
 */
export interface ServiceMethod<Args extends any[] = any[], Result = any> {
  /** The wire declaration fed into {@link defineService}. */
  def: RpcMethodDef<Args, Result>;
  /** The worker-side implementation fed into {@link implementService}. */
  run(...args: Args): Result | Promise<Result>;
}

/** The args a method def declares — argsSchema's tuple, else an rpc<A,R>() declaration's type args, else []. */
type DefArgs<D> =
  D extends { argsSchema: Schema<infer A extends any[]> }
    ? A
    : D extends { resultSchema: Schema<any> }
      ? []
      : D extends RpcMethodDef<infer A extends any[], any>
        ? A
        : [];

/** The result a method def declares — resultSchema's output, else an rpc<A,R>() declaration's type args, else unknown. */
type DefResult<D> =
  D extends { resultSchema: Schema<infer R> }
    ? R
    : D extends RpcMethodDef<any[], infer R>
      ? R
      : unknown;

/**
 * Builds a {@link ServiceMethod} unit — the factory form of
 * `{ def, run } satisfies ServiceMethod<…>`. The def's schemas (or an
 * `rpc<A,R>()` declaration's type args) supply the signature, so `run`
 * gets contextual parameter types with nothing to annotate:
 *
 *   export const queryIncidents = serviceMethod({
 *     def: { argsSchema: z.tuple([queryArgsSchema]), resultSchema: queryResultSchema },
 *     run(q) { … },                     // q: QueryArgs — inferred
 *   });
 *
 * The unit's exact type is returned unchanged, so extra fields (config,
 * counters) ride along for implementService's `this`-binding — `run`'s
 * `this` is the unit; annotate it to type extra fields:
 * `run(this: { prefix: string }, name) { … }`.
 */
export function serviceMethod<
  D extends RpcMethodDef,
  U extends { def: D },
>(
  unit: U & {
    run: (...args: DefArgs<D>) => DefResult<D> | Promise<DefResult<D>>;
  },
): U {
  return unit;
}

/** A service method entry: a bare RpcMethodDef or a full {@link ServiceMethod} unit. */
export type RpcMethodInput = RpcMethodDef<any[], any> | ServiceMethod<any[], any>;
export type RpcMethodMap = Record<string, RpcMethodDef<any[], any>>;
export type RpcMethodInputMap = Record<string, RpcMethodInput>;

/**
 * Resolves a method declaration to its TaskContract type. Schemas win when
 * present (argsSchema+resultSchema → full signature; resultSchema alone →
 * a no-arg method); an rpc<A,R>() declaration's type args carry the rest.
 */
type MethodContract<D> =
  D extends { def: infer Def }
    ? MethodContract<Def>   // ServiceMethod unit — unwrap the def
    : D extends { argsSchema: Schema<infer A extends any[]> }
    ? D extends { resultSchema: Schema<infer R> }
      ? TaskContract<A, R>
      : TaskContract<A, any>
    : D extends { resultSchema: Schema<infer R> }
      ? TaskContract<[], R>
      : D extends RpcMethodDef<infer A extends any[], infer R>
        ? TaskContract<A, R>
        : TaskContract<any[], any>;

type MethodsToContracts<M extends RpcMethodInputMap> = {
  [K in keyof M]: MethodContract<M[K]>;
};

/**
 * A named bundle of RPC method contracts shared by both threads. `tasks` is
 * a fully-typed {@link TaskMap} — hand it to `WorkerPool`/`SharedWorker`
 * config or iterate it for registration.
 */
export interface ServiceContract<M extends RpcMethodInputMap = RpcMethodInputMap> {
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
export function defineService<M extends RpcMethodInputMap>(
  name: string,
  methods: M,
): ServiceContract<M> {
  const tasks = {} as Record<string, TaskContract>;
  for (const [method, input] of Object.entries(methods)) {
    const def = 'def' in input ? input.def : input;
    tasks[method] = {
      taskId: def.taskId ?? `${name}.${method}`,
      ...(def.dataType ? { dataType: def.dataType } : {}),
      ...(def.argsSchema ? { argsSchema: def.argsSchema } : {}),
      ...(def.resultSchema ? { resultSchema: def.resultSchema } : {}),
    };
  }
  return { name, tasks: tasks as MethodsToContracts<M> };
}

type ServiceHandlerFn<A extends any[], R> = (...args: A) => R | Promise<R>;

/** The handler signatures a service implementation must provide. */
export type ServiceHandlers<M extends RpcMethodInputMap> = {
  [K in keyof M]: MethodContract<M[K]> extends TaskContract<infer A, infer R>
    ? ServiceHandlerFn<A, R> | { run: ServiceHandlerFn<A, R> }
    : never;
};

/**
 * A service contract bound to handler implementations — the worker-side
 * "service" that owns the RPC methods. Registration happens eagerly inside
 * {@link implementService}; the returned handle is for composition/testing.
 */
export interface ServiceImpl<M extends RpcMethodInputMap = RpcMethodInputMap> {
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
export function implementService<M extends RpcMethodInputMap>(
  service: ServiceContract<M>,
  handlers: ServiceHandlers<M>,
): ServiceImpl<M> {
  const missing = Object.keys(service.tasks).filter((k) => {
    const h = handlers[k] as unknown;
    return typeof h !== 'function' && typeof (h as { run?: unknown })?.run !== 'function';
  });
  if (missing.length > 0) {
    throw new Error(
      `implementService("${service.name}"): missing handlers for ${missing.join(', ')}`,
    );
  }
  for (const [method, contract] of Object.entries(service.tasks)) {
    const h = handlers[method] as ServiceHandlerFn<any[], any> | { run: ServiceHandlerFn<any[], any> };
    // Function form binds to the handlers object (sibling calls, DI
    // instances); unit form binds `run` to the unit itself.
    TaskRegistry.register(
      contract,
      typeof h === 'function' ? h.bind(handlers) : h.run.bind(h),
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
