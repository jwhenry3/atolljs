export {
  ProxyNode,
  ProxyText,
  ProxyFragment,
} from './dom/node';
export type { ProxyEventHandler } from './dom/node';
export {
  ProxyElement,
} from './dom/element';
export type {
  AdjacentPosition,
  ProxyClassList,
} from './dom/element';
export {
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
