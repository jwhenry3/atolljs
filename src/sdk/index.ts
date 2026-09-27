/* ── Contract — shared memory declarations (both threads) ───────────────── */

export { defineSharedMemory, field, jsonCodec, registerConnectorFactory } from './contract/sharedMemory';
export type {
  Codec,
  Connector,
  ConnectorContext,
  ConnectorFactory,
  FieldDescriptor,
  SharedAccess,
  SharedMemory,
  SharedMemoryOptions,
  SharedSpec,
  ScalarKind,
  StructConnector,
  StructDescriptor,
  StructFieldSpec,
  StructRecord,
  StructSpec,
} from './contract/sharedMemory';
export { msgpackCodec } from './contract/msgpackCodec';
export { msgpackrCodec } from './contract/msgpackrCodec';
export { structSchema } from './contract/structSchema';
export type { StructZodShape } from './contract/structSchema';
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

/* ── SharedWorker — one worker (and one buffer) across tabs/iframes ──────── */

export { connectSharedWorker } from './shared/sharedWorkerClient';
export type { SharedWorkerClient } from './shared/sharedWorkerClient';
export { sharedWorkerHost } from './shared/sharedWorkerHost';

/* ── Service — framework-neutral RPC contracts shared by both threads ────── */

export { createClient, defineService, implementService, rpc } from './service';
export type {
  RpcMethodDef,
  RpcMethodMap,
  ServiceClient,
  ServiceContract,
  ServiceHandlers,
  ServiceImpl,
  TaskRunner,
} from './service';

/* ── Worker — worker-side runtime ───────────────────────────────────────── */

export { TaskRegistry } from './worker/registry';

/* ── Shared runtime utilities ───────────────────────────────────────────── */

export { reactive, shallowEqual, watch } from './reactive';
export type { EqualityFn, ReactiveConnector, SliceOptions } from './reactive';
export { observe } from './observable';
export type { ObservableValue } from './observable';
export { defineTask } from './task';
export type { AsyncTask, TaskSnapshot } from './task';
export { getLogLevel, log, scoped, setLogLevel, setLogSink } from './log';
export type { LogEntry, LogLevel, LogSink } from './log';
