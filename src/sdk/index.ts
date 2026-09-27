/* ── Contract — shared memory declarations (both threads) ───────────────── */

export { defineSharedMemory, field, jsonCodec, registerConnectorFactory } from './contract/sharedMemory';
export { mz } from './contract/mz';
export type {
  Codec,
  Connector,
  ConnectorContext,
  ConnectorFactory,
  FieldDescriptor,
  FieldGroup,
  FieldSchema,
  FixedArrayDescriptor,
  FixedObjectDescriptor,
  FlatKey,
  InferField,
  PathConnector,
  SpecPath,
  SpecSchemas,
  SharedAccess,
  SharedMemory,
  SharedMemoryOptions,
  SharedSpec,
  ScalarKind,
  ListConnector,
  ListDescriptor,
  ListFieldSpec,
  ListFields,
  ListMember,
  ListRecord,
  ListSpec,
} from './contract/sharedMemory';
export { msgpackCodec } from './contract/msgpackCodec';
export { msgpackrCodec } from './contract/msgpackrCodec';
export { listSchema } from './contract/listSchema';
export type { ListZodShape } from './contract/listSchema';
export type {
  MemoryConfig,
  PoolTasks,
  Prettify,
  Schema,
  Logger,
  TaskContract,
  TaskMap,
  TaskMessage,
  TaskResult,
  SharedWorkerConfig,
  ViewType,
  WorkerPoolConfig,
} from './contract/types';

/* ── Pool — main-thread runtime ─────────────────────────────────────────── */

export { MemoryManager } from './pool/memory';
export { WorkerPool } from './pool/workerPool';
export { connectWorker, workerClient } from './pool/workerClient';
export type {
  ClientMethods,
  ConnectWorkerConfig,
  WorkerClient,
  WorkerMethods,
} from './pool/workerClient';

/* ── SharedWorker — one worker (and one buffer) across tabs/iframes ──────── */

export { connectSharedWorker } from './shared/sharedWorkerClient';
export type { SharedWorkerClient } from './shared/sharedWorkerClient';
export { sharedWorkerHost } from './shared/sharedWorkerHost';

/* ── Service — framework-neutral RPC contracts shared by both threads ────── */

export { createClient, defineService, implementService, rpc, serviceMethod } from './service';
export type {
  RpcMethodDef,
  RpcMethodInput,
  RpcMethodInputMap,
  RpcMethodMap,
  ServiceClient,
  ServiceContract,
  ServiceHandlers,
  ServiceImpl,
  ServiceMethod,
  TaskRunner,
} from './service';

/* ── Worker — worker-side runtime ───────────────────────────────────────── */

export { TaskRegistry } from './worker/registry';
export { defineWorker, RESERVED_CLIENT_KEYS } from './worker/defineWorker';
export type {
  DefineWorkerConfig,
  WorkerDefinition,
  WorkerMethod,
  WorkerMethodMap,
  WorkerServiceMap,
} from './worker/defineWorker';

/* ── Shared runtime utilities ───────────────────────────────────────────── */

export { reactive, shallowEqual, watch } from './reactive';
export type { EqualityFn, ReactiveConnector, SliceOptions } from './reactive';
export { observe } from './observable';
export type { ObservableValue } from './observable';
export { defineTask, isAsyncTask, toTask } from './task';
export type { AsyncTask, TaskSnapshot } from './task';
export { getLogLevel, log, scoped, setLogLevel, setLogSink } from './log';
export type { LogEntry, LogLevel, LogSink } from './log';
