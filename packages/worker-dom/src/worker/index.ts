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
export { defineIslandWorker } from './defineIslandWorker';
export type {
  DefineIslandWorkerOptions,
  ImperativeIslandApp,
  IslandApp,
  ReactIslandApp,
  Realm,
} from './defineIslandWorker';

export {
  allocId,
  bumpOpsVersion,
  emit,
  getActiveRealm,
  getHandler,
  hostConfig,
  instances,
  pushOp,
  registerHandler,
  ROOT_CONTAINER,
  runInRealm,
  setActiveRealm,
  setDoorbellContract,
  takeOps,
  unregisterHandler,
} from './hostConfig';
export type { ElementInstance, HostInstance, TextInstance } from './hostConfig';

export {
  createProxyDocument,
  installDomShim,
  InternalDocument,
  ProxyElement,
  ProxyNode,
  ProxyText,
} from './proxyDom';
export type {
  AdjacentPosition,
  ProxyClassList,
  ProxyDocument,
  ProxyEventHandler,
  WindowShim,
} from './proxyDom';

export { Slot } from './slot';

export type { EventPayload, IslandWorkerMethods, Op, WireProps } from '../ops';
export { isEventRef } from '../ops';
export { renderMemory } from '../memory';
export type { DoorbellSpec } from '../memory';
