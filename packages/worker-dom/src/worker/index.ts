/**
 * The worker-side surface of @jwhenry123/mesh-worker-dom — import from
 * '@jwhenry123/mesh-worker-dom/worker' inside the worker entry:
 *
 *   import { defineIslandWorker } from '@jwhenry123/mesh-worker-dom/worker';
 *   export const renderWorker = defineIslandWorker({ apps: { ... } });
 *
 * Apps (React or `{ imperative }`) also use from here: `emit` (island→shell
 * channel), `runInRealm` (realm scoping for worker-initiated work), `Slot`
 * (transclusion), `createProxyDocument`/`installDomShim` (imperative DOM).
 */
export { defineIslandWorker, defineRealmWorker } from './defineIslandWorker';
export type {
  DefineIslandWorkerOptions,
  ImperativeIslandApp,
  IslandApp,
  ReactIslandApp,
  Realm,
  RenderContext,
  RenderedHandle,
  RenderedIslandApp,
} from './defineIslandWorker';

export { islandApp, islandAppNameOf } from '../app';

// hostConfig is deliberately NOT exported — a static re-export would pull
// react + react-reconciler into every /worker bundle. The reconciler is
// reachable only through defineIslandWorker's lazy import of reactRealm.

export {
  allocId,
  bumpOpsVersion,
  emit,
  getActiveRealm,
  getHandler,
  getLastActiveRealm,
  getLastTouchedRealm,
  getRealmSize,
  instances,
  pushOp,
  registerHandler,
  ROOT_CONTAINER,
  runInRealm,
  setActiveRealm,
  setDoorbellContract,
  setRealmSize,
  takeOps,
  unregisterHandler,
} from './realm';
export type { ElementInstance, HostInstance, TextInstance } from './realm';

export {
  createProxyDocument,
  installDomShim,
  installRealmDispatcher,
  ProxyComment,
  ProxyElement,
  ProxyFragment,
  ProxyNode,
  ProxyText,
  realmDocFor,
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
