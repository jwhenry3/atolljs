/**
 * The worker-side surface of @jwhenry123/mesh-islands — import from
 * '@jwhenry123/mesh-islands/worker' inside the worker entry:
 *
 *   import { definePolyWorker } from '@jwhenry123/mesh-islands/worker';
 *   export const renderWorker = definePolyWorker({ apps: { ... } });
 *
 * Apps (React or `{ imperative }`) also use from here: `emit` (island→shell
 * channel), `runInInstance` (instance scoping for worker-initiated work), `Slot`
 * (transclusion), `createProxyDocument`/`installDomShim` (imperative DOM).
 */
export { definePolyWorker, defineMonoWorker } from './defineWorkers';
export type {
  ImperativeIslandApp,
  Instance,
  IslandApp,
  PolyWorkerRegistry,
  ReactIslandApp,
  RenderContext,
  RenderedHandle,
  RenderedIslandApp,
} from './defineWorkers';

export { islandApp, islandAppNameOf } from '../app';

// hostConfig is deliberately NOT exported — a static re-export would pull
// react + react-reconciler into every /worker bundle. The reconciler is
// reachable only through definePolyWorker's lazy import of reactInstance.

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
  pushOp,
  registerHandler,
  ROOT_CONTAINER,
  runInInstance,
  setActiveInstance,
  setDoorbellContract,
  setInstanceSize,
  takeOps,
  unregisterHandler,
} from './instance';
export type { ElementInstance, HostInstance, TextInstance } from './instance';

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

export { Slot } from './slot';

export type { EventPayload, IslandWorkerMethods, Op, WireProps } from '../ops';
export { isEventRef } from '../ops';
export { renderMemory } from '../memory';
export type { DoorbellSpec } from '../memory';
