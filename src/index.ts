/* ── Contract — shared memory declarations (both threads) ───────────────── */

export { bindSharedMemories, defineSharedMemory, field, getDefinedSharedMemoryCount, jsonCodec, registerConnectorFactory } from './contract/sharedMemory';
export { reef } from './contract/reef';
export { z, SchemaError } from './contract/zod';
export type { ZodLike } from './contract/zod';
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
  MemoryPersistence,
  SharedWorkerConfig,
  ViewType,
  WorkerPoolConfig,
} from './contract/types';

/* ── Pool — main-thread runtime ─────────────────────────────────────────── */

export { MemoryManager } from './pool/memory';
export { WorkerPool } from './pool/workerPool';
export type { PoolStats, RunOptions } from './pool/workerPool';
export {
  PoolQueueFullError,
  TaskAbortedError,
  TaskTimeoutError,
  WorkerCrashedError,
} from './pool/errors';
export { DedicatedWorker } from './pool/dedicatedWorker';
export type { DedicatedWorkerConfig } from './pool/dedicatedWorker';
export { connectWorker, resolveWorkerCount, workerClient } from './pool/workerClient';
export type {
  ClientMethods,
  ConnectWorkerConfig,
  WorkerClient,
  WorkerMethods,
  WorkerRunner,
} from './pool/workerClient';
export { connectSubWorker } from './pool/subWorkerClient';
export type { ConnectSubWorkerConfig } from './pool/subWorkerClient';

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
export {
  addDevtoolsSink,
  devtoolsEnabled,
  emitDevtools,
  estimateCloneBytes,
  installFetchProbe,
  installMemoryProbe,
  listDevtoolsCommands,
  previewValue,
  registerDevtoolsCommand,
  runDevtoolsCommand,
  setDevtoolsSink,
} from './devtools';
export type {
  DevtoolsCommandHandler,
  DevtoolsEvent,
  DevtoolsSink,
  DevtoolsThread,
  EmittedDevtoolsEvent,
  TaskSettleOutcome,
} from './devtools';
