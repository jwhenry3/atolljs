/**
 * The remote-module format — what a "published MFE" looks like to a
 * federation host.
 *
 * A remote module is a plain ES module (usually a bundled app chunk) the
 * host worker `import()`s on first mount of one of its apps. Unlike the
 * remote WORKER bundles in docs/islands-remote.md — self-contained scripts
 * that spawn their own realm — a remote module carries NO worker runtime:
 * it lands inside the host's realm, so its shared-dependency imports
 * resolve to the host's copies and its registry entries live beside the
 * host's local apps.
 *
 * ```ts
 * // checkout.app.ts — the remote's published entry
 * import { defineRemoteApp } from '@atolljs/federation';
 * import { reactIslandApp } from '@atolljs/react-island/worker';
 * import { checkoutContract } from './checkout.contract';
 *
 * export const requires = { react: '^18' };
 * export const exposes = {
 *   checkout: defineRemoteApp(withContract(checkoutContract, reactIslandApp(Checkout))),
 * };
 * ```
 *
 * The host resolves an app key against three shapes, in order:
 * `exposes[name]`, then `default`, then a named export matching the key.
 * `requires` — module-level or stamped per app — is checked against the
 * host's shared scope before the app registers: an unsatisfiable range
 * fails the mount loudly instead of running against a wrong-version
 * singleton.
 */
import type { IslandApp } from '@atolljs/islands/worker';

/** Per-app metadata stamped by `defineRemoteApp`. */
export interface RemoteAppMeta {
  /** Shared deps this app needs from the host scope: name → version range. */
  requires?: Record<string, string>;
}

const REMOTE_META = 'atollRemoteApp';

/** Stamp an app with remote metadata — rides the object like `withContract`. */
export function defineRemoteApp<A extends IslandApp>(app: A, meta?: RemoteAppMeta): A {
  (app as unknown as Record<string, unknown>)[REMOTE_META] = meta ?? {};
  return app;
}

/** Read the meta a `defineRemoteApp` stamp carries (undefined when unstamped). */
export const remoteAppMetaOf = (app: unknown): RemoteAppMeta | undefined => {
  if (typeof app !== 'object' || app === null) return undefined;
  const meta = (app as Record<string, unknown>)[REMOTE_META];
  return typeof meta === 'object' && meta !== null ? (meta as RemoteAppMeta) : undefined;
};

const isIslandAppShape = (v: unknown): v is IslandApp =>
  typeof v === 'object' && v !== null && ('imperative' in v || 'mount' in v);

/**
 * What a loaded remote module namespace contributed: the app to register
 * and every `requires` range found (module-level plus app-stamped).
 */
export interface ResolvedRemote {
  app: IslandApp;
  requires: Record<string, string>;
}

/**
 * Pick the exposed app out of an imported remote module namespace.
 * Resolution order: `exposes[name]` → `default` → `mod[name]`. Throws a
 * descriptive error (naming what the module DID export) when none match —
 * "remote didn't expose the app" is the federation analogue of the
 * "app not registered" drift failure.
 */
export const resolveRemoteModule = (mod: unknown, name: string): ResolvedRemote => {
  const ns = (typeof mod === 'object' && mod !== null ? mod : {}) as Record<string, unknown>;
  const moduleRequires =
    typeof ns.requires === 'object' && ns.requires !== null
      ? (ns.requires as Record<string, string>)
      : {};

  let app: IslandApp | undefined;
  const exposes = ns.exposes;
  if (typeof exposes === 'object' && exposes !== null) {
    const candidate = (exposes as Record<string, unknown>)[name];
    if (isIslandAppShape(candidate)) app = candidate;
  }
  if (app === undefined && isIslandAppShape(ns.default)) app = ns.default;
  if (app === undefined && isIslandAppShape(ns[name])) app = ns[name] as IslandApp;

  if (app === undefined) {
    throw new Error(
      `[federation] remote module for "${name}" exposes no island app — ` +
        `looked at exposes.${name}, default, and a "${name}" export; ` +
        `module has keys: ${Object.keys(ns).join(', ') || '(none)'}`,
    );
  }

  return {
    app,
    requires: { ...moduleRequires, ...(remoteAppMetaOf(app)?.requires ?? {}) },
  };
};
