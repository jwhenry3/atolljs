/**
 * `@atolljs/devtools/node` — the Node-facing entry.
 *
 * Same API as the browser entry, minus the browser-only pieces: there is no
 * BroadcastChannel transport (WebSocket is the only path — the global
 * WebSocket on Node ≥ 22, the bundled dependency-free client below it) and
 * no overlay flyout (there's no page to mount it in). `initDevtools` gates
 * on the ATOLL_DEVTOOLS env var instead of the ?__atoll_devtools URL param;
 * the dashboard is the standalone aggregate server (`atoll devtools`).
 *
 *   import { initDevtools } from '@atolljs/devtools/node';
 *   initDevtools({ session: { name: 'my-api' } });
 */
export { connectDevtools } from './client';
export type { ConnectDevtoolsOptions, DevtoolsConnection } from './client';
export { initDevtools, devtoolsEnabled, DEVTOOLS_PARAM } from './init';
export type { InitDevtools, InitDevtoolsOptions } from './init';
export type { SessionInfo } from './protocol';
