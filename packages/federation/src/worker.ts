/**
 * The worker-side surface of @atolljs/federation — import inside the
 * federation host worker entry:
 *
 *   import { defineFederationHost } from '@atolljs/federation/worker';
 *   export const host = defineFederationHost({ remotes, shared });
 *
 * `defineRemoteApp` and the shared scope also live here: remote app
 * modules (bundled by the publisher, imported by the host) stamp and read
 * through the same API.
 */
export { defineFederationHost } from './host';
export type { FederationHostOptions, RemoteRef } from './host';

export { provideShared, useShared, sharedVersionOf, sharedDeps, satisfiesVersion } from './share';
export type { SharedEntry } from './share';

export { defineRemoteApp, remoteAppMetaOf } from './remote';
export type { RemoteAppMeta } from './remote';
