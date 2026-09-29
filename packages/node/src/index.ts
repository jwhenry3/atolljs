// Node runtime adapter for the Atoll — node:worker_threads pools without a
// framework. Worker entries must import '@atolljs/node/shim' first.
export { NodeWorkerAdapter, createNodeWorker } from './worker';
export type { WorkerErrorEvent } from './worker';
export { createNodePool } from './pool';
export type { NodePoolConfig } from './pool';
