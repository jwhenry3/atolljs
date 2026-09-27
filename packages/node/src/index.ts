// Node runtime adapter for the mesh — node:worker_threads pools without a
// framework. Worker entries must import '@jwhenry123/mesh-node/shim' first.
export { NodeWorkerAdapter, createNodeWorker } from './worker';
export { createNodePool } from './pool';
export type { NodePoolConfig } from './pool';
