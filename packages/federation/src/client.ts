/**
 * The shell side of a federation host — one `connectIslandWorker` client
 * over the host worker entry. Every island mounted on the client lands in
 * the host's realm: remote app modules share its module graph, its shared
 * scope, and its failure domain (the shared-client trade-off documented in
 * docs/islands.md — a crashing remote takes its siblings).
 *
 * ```ts
 * const fed = connectFederation({
 *   worker: () => new Worker(new URL('./federation.worker.ts', import.meta.url), { type: 'module' }),
 * });
 * await mountIsland({ client: fed, el, app: 'checkout', props }); // first mount imports the remote
 * ```
 *
 * The contract layer is untouched — `IslandContract`s still type mounts
 * and validate props worker-side; a remote key just resolves lazily.
 */
import { connectIslandWorker } from '@atolljs/islands';
import type { ConnectIslandWorkerConfig, IslandClient } from '@atolljs/islands';

/** A federation host client — an `IslandClient` whose worker runs `defineFederationHost`. */
export type FederationClient = IslandClient;

/**
 * Connect a federation host worker. Identical options to
 * `connectIslandWorker` (including `doorbell: false` for non-isolated
 * pages); the name exists so call sites read as federation topology.
 */
export const connectFederation = (config: ConnectIslandWorkerConfig): FederationClient =>
  connectIslandWorker(config);
