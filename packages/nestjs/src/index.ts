export { MeshModule } from './module';
export { MeshTask, getMeshTaskMeta } from './decorators';
export type { MeshTaskMeta } from './decorators';
export { registerMeshHandlers } from './handlers';
export { InjectMeshPool } from './injectPool';
export { runMeshWorker } from './worker';
// Node runtime pieces live in @jwhenry123/mesh-node — re-exported here for
// convenience; worker entries should import the shim via
// '@jwhenry123/mesh-node/shim' (never through a barrel).
export { NodeWorkerAdapter, createNodeWorker } from '@jwhenry123/mesh-node';
export {
  buildMeshPool,
  getMeshPool,
  getMeshPoolToken,
  registerMeshPool,
  unregisterMeshPool,
} from './pools';
export type { MeshModuleOptions, MeshPoolConfig } from './pools';
