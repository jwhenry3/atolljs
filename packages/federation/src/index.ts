/**
 * @atolljs/federation — controlled module federation for worker islands.
 *
 * Three surfaces:
 * - `.` (this entry): shared-dependency scope, remote-module metadata,
 *   manifests, and the shell client. Framework-free; safe on both threads.
 * - `./worker`: `defineFederationHost` — the host worker definer (imported
 *   inside the federation worker entry only).
 * - `./vite`: `atollFederation` — the publish-build plugin that
 *   externalizes shared deps to pinned URLs and emits the manifest.
 */
export { provideShared, useShared, sharedVersionOf, sharedDeps, satisfiesVersion } from './share';
export type { SharedEntry } from './share';

export { defineRemoteApp, remoteAppMetaOf, resolveRemoteModule } from './remote';
export type { RemoteAppMeta, ResolvedRemote } from './remote';

export { parseRemoteManifest, fetchRemoteManifest } from './manifest';
export type { RemoteManifest } from './manifest';

export { connectFederation } from './client';
export type { FederationClient } from './client';

export type { RemoteRef, FederationHostOptions } from './host';
