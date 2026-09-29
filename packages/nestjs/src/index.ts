export { AtollModule } from './module';
export type { AtollModuleAsyncOptions, AtollPoolAsyncOptions } from './module';
export { AtollService, AtollTask, getAtollTaskMeta } from './decorators';
export type { AtollTaskMeta } from './decorators';
export { bindAtollWorkerInstance } from './decorators';
export { registerAtollHandlers } from './handlers';
export { InjectAtollPool } from './injectPool';
export { runAtollWorker } from './worker';
// Node runtime pieces live in @atolljs/node — re-exported here for
// convenience; worker entries should import the shim via
// '@atolljs/node/shim' (never through a barrel).
export { NodeWorkerAdapter, createNodeWorker } from '@atolljs/node';
export {
  buildAtollPool,
  getAtollPool,
  getAtollPoolToken,
  registerAtollPool,
  unregisterAtollPool,
} from './pools';
export type { AtollModuleOptions, AtollPoolConfig } from './pools';
