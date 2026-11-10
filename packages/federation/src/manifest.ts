/**
 * Remote manifests — the deploy-time description of what a remote origin
 * exposes, the analogue of module federation's `remoteEntry` metadata.
 *
 * A manifest is small JSON served beside the remote's bundles:
 *
 * ```json
 * {
 *   "name": "checkout-mfe",
 *   "version": "1.4.0",
 *   "apps": { "checkout": "./checkout.app.js" },
 *   "requires": { "react": "^18" }
 * }
 * ```
 *
 * App specifiers resolve relative to the manifest's own URL, so one JSON
 * file survives content-hashed filenames and CDN moves — the remote team
 * rewrites only the manifest, never the host's config. `atollFederation`
 * (./vite) emits this file at publish-build time; `defineFederationHost`
 * consumes `{ manifest }` remote refs lazily per app.
 */
export interface RemoteManifest {
  /** The remote's publish name — diagnostics only, the registry key is per app. */
  name: string;
  /** The remote's deploy version — diagnostics/version skew reporting. */
  version?: string;
  /** Registry app key → module specifier (relative to the manifest URL or absolute). */
  apps: Record<string, string>;
  /** Shared deps the whole remote requires: name → version range. */
  requires?: Record<string, string>;
}

/**
 * Validate unknown JSON as a manifest — throws on malformed shape rather
 * than letting a bad deploy surface as a confusing import failure later.
 */
export const parseRemoteManifest = (json: unknown): RemoteManifest => {
  if (typeof json !== 'object' || json === null) {
    throw new Error('[federation] remote manifest is not an object');
  }
  const m = json as Record<string, unknown>;
  if (typeof m.name !== 'string' || m.name === '') {
    throw new Error('[federation] remote manifest requires a "name" string');
  }
  if (
    typeof m.apps !== 'object' ||
    m.apps === null ||
    Object.values(m.apps).some((v) => typeof v !== 'string')
  ) {
    throw new Error('[federation] remote manifest requires an "apps" string map');
  }
  if (
    m.requires !== undefined &&
    (typeof m.requires !== 'object' ||
      m.requires === null ||
      Object.values(m.requires).some((v) => typeof v !== 'string'))
  ) {
    throw new Error('[federation] remote manifest "requires" must be a string map');
  }
  if (m.version !== undefined && typeof m.version !== 'string') {
    throw new Error('[federation] remote manifest "version" must be a string');
  }
  return m as unknown as RemoteManifest;
};

/** Fetch + parse a manifest from a URL — used by `{ manifest: url }` remote refs. */
export const fetchRemoteManifest = async (url: string): Promise<RemoteManifest> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[federation] remote manifest at ${url} answered ${res.status}`);
  }
  return parseRemoteManifest(await res.json());
};
