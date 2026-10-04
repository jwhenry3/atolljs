// @atolljs/devtools — instrumented-app client for browsers (broadcast
// transport, /__atoll/ dashboard, overlay flyout). The aggregate server
// lives at '@atolljs/devtools/server'; Node apps use '@atolljs/devtools/node'
// (env gate, WebSocket-only — no overlay, no BroadcastChannel).
export { connectDevtools } from './client';
export type { ConnectDevtoolsOptions, DevtoolsConnection } from './client';
export { mountDevtoolsOverlay } from './overlay';
export type { DevtoolsOverlay, DevtoolsOverlayOptions } from './overlay';
export { DEVTOOLS_PARAM, devtoolsEnabled, initDevtools } from './init';
export type { InitDevtools, InitDevtoolsOptions } from './init';
export type { SessionInfo } from './protocol';
