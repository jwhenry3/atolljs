export {
  ProxyNode,
  ProxyText,
  ProxyFragment,
  ProxyElement,
  allocPhantomId,
  parseChildren,
  parseSelector,
  matchCompound,
  matchesChain,
  serializeNode,
} from './dom/tree';
export type {
  AdjacentPosition,
  ProxyClassList,
  ProxyEventHandler,
} from './dom/tree';
export {
  activeRealmDoc,
  ambientDoc,
  createProxyDocument,
  realmDocFor,
} from './dom/document';
export type {
  ProxyDocument,
  InternalDocument,
} from './dom/document';
export {
  installRealmDispatcher,
  installDomShim,
} from './dom/window';
export type {
  WindowShim,
  WindowFacadeBundle,
} from './dom/window';
