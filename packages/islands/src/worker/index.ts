/**
 * The worker-side surface of @atolljs/islands — import from
 * '@atolljs/islands/worker' inside the worker entry:
 *
 *   import { definePolyWorker } from '@atolljs/islands/worker';
 *   export const renderWorker = definePolyWorker({ apps: { ... } });
 *
 * Framework apps also use from here: `emit` (island→shell
 * channel), `runInInstance` (instance scoping for worker-initiated work),
 * `createProxyDocument`/`installDomShim` (imperative DOM), plus the
 * renderer-facing instance factories (`newElement`/`newText`/`serializeProps`,
 * `ROOT_CONTAINER`) the `*-island` worker adapters drive.
 *
 * Framework-neutral by construction: this entry imports no framework — React's
 * reconciler adapter lives in `@atolljs/react-island/worker`.
 */
export { definePolyWorker, defineMonoWorker } from './defineWorkers';
export type {
  ImperativeIslandApp,
  Instance,
  IslandApp,
  PolyWorkerRegistry,
  RenderContext,
  RenderedHandle,
  RenderedIslandApp,
} from './defineWorkers';

export { islandApp, islandAppNameOf } from '../app';

export { defineIslandContract, isIslandContract, withContract, contractOf } from '../contract';
export type {
  IslandContract,
  IslandContractEventHandler,
  IslandContractEvents,
  IslandContractProps,
} from '../contract';

export {
  allocId,
  bumpOpsVersion,
  emit,
  getActiveInstance,
  getHandler,
  getLastActiveInstance,
  getLastTouchedInstance,
  getInstanceSize,
  instances,
  newElement,
  newText,
  proxyInstanceStats,
  pushOp,
  registerHandler,
  ROOT_CONTAINER,
  runInInstance,
  serializeProps,
  setActiveInstance,
  setDoorbellContract,
  setInstanceSize,
  takeOps,
  unregisterHandler,
} from './instance';
export type { ElementInstance, HostInstance, RootContainer, TextInstance } from './instance';

export {
  createProxyDocument,
  installDomShim,
  installInstanceDispatcher,
  ProxyComment,
  ProxyElement,
  ProxyFragment,
  ProxyNode,
  ProxyText,
  docForInstance,
} from './proxyDom';
export type {
  AdjacentPosition,
  InternalDocument,
  ProxyClassList,
  ProxyDocument,
  ProxyEventHandler,
  WindowShim,
  WireListenerOpts,
} from './proxyDom';

export type { EventPayload, IslandWorkerMethods, Op, WireProps } from '../ops';
export { isEventRef } from '../ops';
export { renderMemory } from '../memory';
export type { DoorbellSpec } from '../memory';

export { mountSubIsland } from './subIsland';
export type { MountSubIslandOptions, SubIslandHandle } from './subIsland';

// Nested-island clients: `connectIslandWorker` is thread-agnostic — a worker
// shell calls it to spawn a sub-worker. `mountIsland` is the ONE surface:
// a proxy `el` (inside a worker-rendered tree) delegates to the registered
// sub-mounter in ./subIsland; a real `el` drives the main-thread applier.
export { connectIslandWorker, mountIsland } from '../island';
export type {
  ConnectIslandWorkerConfig,
  IslandClient,
  IslandHandle,
  Mode,
  MountIslandOptions,
} from '../island';
