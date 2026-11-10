/**
 * `defineFederationHost` — a PolyWorker whose registry is dynamic.
 *
 * ```ts
 * // federation.worker.ts — the host worker entry (shell-owned)
 * import { defineFederationHost } from '@atolljs/federation/worker';
 *
 * export const host = defineFederationHost({
 *   remotes: {
 *     checkout: 'https://mfe.example.com/checkout.app.js',
 *     notes: { manifest: 'https://mfe.example.com/mfe.manifest.json' },
 *     dial: () => import('./dial.app'), // local module through the same seam
 *   },
 *   shared: {
 *     react: { module: React, version: '18.3.1' },
 *   },
 * });
 * ```
 *
 * The mount seam is unchanged: the shell mounts `app: 'checkout'` on a
 * `connectIslandWorker` client and the FIRST mount for an unregistered key
 * runs the loader — the remote module is imported INSIDE the worker's
 * realm, so its shared-dependency imports and `useShared` reads resolve to
 * this worker's copies (one framework instance, one store). That is the
 * federation promise: shared module identity across MFE boundaries,
 * enforced by realm, not by convention.
 *
 * Version negotiation happens before registration: the remote module's
 * `requires` ranges must be satisfied by the scope this host published
 * (its `shared` option plus any earlier `provideShared` calls), or the
 * mount rejects with a named error — the shared-deps analogue of contract
 * prop rejection.
 */
import type { SharedMemory } from '@atolljs/core';
import { definePolyWorker } from '@atolljs/islands/worker';
import type { DoorbellSpec, IslandApp } from '@atolljs/islands/worker';
import type { IslandWorkerDefinition } from '@atolljs/islands';
import { fetchRemoteManifest, parseRemoteManifest } from './manifest';
import type { RemoteManifest } from './manifest';
import { resolveRemoteModule } from './remote';
import { provideShared, satisfiesVersion, sharedVersionOf } from './share';
import type { SharedEntry } from './share';

/**
 * How the host finds one remote's module, per app key:
 * - `string` — a module specifier, `import()`ed lazily inside the worker
 *   (remote URL, or a dev-server path — whatever the worker's loader can fetch)
 * - `{ url, requires? }` — same, with an extra requires overlay checked
 *   against the shared scope before registration
 * - `{ manifest }` — a RemoteManifest object or its URL; the app key
 *   indexes `manifest.apps`, whose specifiers resolve relative to the
 *   manifest URL
 * - `() => Promise<module>` — an importer, for same-repo modules through
 *   the same seam (`() => import('./dial.app')`) or custom loaders
 */
export type RemoteRef =
  | string
  | { url: string; requires?: Record<string, string> }
  | { manifest: string | RemoteManifest }
  | (() => Promise<unknown>);

export interface FederationHostOptions {
  /**
   * Registry app key → remote module reference. Lazy: nothing is imported
   * or fetched until the first mount names the key. Several keys may share
   * one manifest or one module URL.
   */
  remotes?: Record<string, RemoteRef>;
  /** Local apps mixed into the same registry — the host's own MFEs. */
  apps?: Record<string, IslandApp>;
  /**
   * Shared deps this host publishes before any remote loads: name → the
   * module object, or `{ module, version }`. A bare value publishes at
   * version '0' (unversioned — remote ranges still match '*').
   */
  shared?: Record<string, unknown | SharedEntry>;
  /** Custom doorbell contract — see `definePolyWorker`. */
  sharedMemory?: SharedMemory<DoorbellSpec>;
}

interface LoadedRemote {
  mod: unknown;
  requires: Record<string, string>;
}

export function defineFederationHost(
  options: FederationHostOptions,
): IslandWorkerDefinition {
  const remotes = options.remotes ?? {};

  // Publish the shared scope FIRST — remote modules may read useShared() at
  // module evaluation time, so the scope must be populated before the first
  // import() lands.
  const provided: Record<string, string> = {};
  for (const [name, dep] of Object.entries(options.shared ?? {})) {
    const entry =
      typeof dep === 'object' && dep !== null && 'module' in dep
        ? (dep as SharedEntry)
        : { module: dep, version: '0' };
    provideShared(name, entry.module, entry.version ?? '0');
    provided[name] = entry.version ?? '0';
  }

  // Manifest URLs are fetched once and shared by every app key pointing at
  // them — a manifest-backed remote maps several keys to one JSON file.
  const manifestCache = new Map<string, Promise<RemoteManifest>>();
  const manifestFor = (ref: string | RemoteManifest): Promise<RemoteManifest> => {
    if (typeof ref !== 'string') return Promise.resolve(parseRemoteManifest(ref));
    let cached = manifestCache.get(ref);
    if (cached === undefined) {
      cached = fetchRemoteManifest(ref);
      manifestCache.set(ref, cached);
    }
    return cached;
  };

  const loadModule = async (name: string, ref: RemoteRef): Promise<LoadedRemote> => {
    if (typeof ref === 'function') return { mod: await ref(), requires: {} };
    if (typeof ref === 'string') {
      return { mod: await import(/* @vite-ignore */ ref), requires: {} };
    }
    if ('url' in ref) {
      return {
        mod: await import(/* @vite-ignore */ ref.url),
        requires: ref.requires ?? {},
      };
    }
    // manifest-backed: the app key resolves through apps[name]; relative
    // specifiers resolve against the manifest's own URL.
    const isUrl = typeof ref.manifest === 'string';
    const manifest = await manifestFor(ref.manifest);
    const specifier = manifest.apps[name];
    if (specifier === undefined) {
      throw new Error(
        `[federation] remote "${manifest.name}" has no "${name}" app — ` +
          `manifest exposes: ${Object.keys(manifest.apps).join(', ')}`,
      );
    }
    const url = isUrl ? new URL(specifier, ref.manifest as string).href : specifier;
    return { mod: await import(/* @vite-ignore */ url), requires: manifest.requires ?? {} };
  };

  const checkRequires = (name: string, requires: Record<string, string>): void => {
    for (const [dep, range] of Object.entries(requires)) {
      const version = sharedVersionOf(dep);
      if (version === undefined) {
        throw new Error(
          `[federation] remote app "${name}" requires shared dep "${dep}@${range}" — ` +
            `this host provides: ${Object.keys(provided).join(', ') || '(none)'}`,
        );
      }
      if (!satisfiesVersion(version, range)) {
        throw new Error(
          `[federation] remote app "${name}" requires "${dep}@${range}" — ` +
            `host provides v${version}`,
        );
      }
    }
  };

  return definePolyWorker({
    apps: options.apps ?? {},
    sharedMemory: options.sharedMemory,
    loadApp: async (name) => {
      const ref = remotes[name];
      if (ref === undefined) return undefined;
      const loaded = await loadModule(name, ref);
      const { app, requires } = resolveRemoteModule(loaded.mod, name);
      checkRequires(name, { ...loaded.requires, ...requires });
      return app;
    },
  });
}
