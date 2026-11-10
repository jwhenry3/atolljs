/**
 * `atollFederation` — the publish-build half of controlled federation.
 *
 * The host worker's realm dedupes a shared dep only when every bundle that
 * uses it imports the SAME module specifier. This plugin makes that
 * agreement mechanical: `shared` externalizes the dep and rewrites its
 * import specifier to the pinned URL via Rollup `output.paths`, so the
 * remote's emitted chunk carries `import ... from
 * "https://shell.example/@atoll-shared/react@18.3.1.js"` verbatim — the
 * same URL the host's own build externalized to. Realm-level ESM dedupe
 * does the rest.
 *
 * It also emits the remote manifest (`mfe.manifest.json` by default):
 * app key → emitted chunk name, plus declared `requires` ranges — the
 * file `{ manifest }` remote refs fetch at mount time.
 *
 * ```ts
 * // vite.mfe.config.ts — the remote's publish build
 * export default defineConfig({
 *   plugins: [
 *     atollFederation({
 *       name: 'checkout-mfe',
 *       exposes: { checkout: 'src/mfe/checkout.app.ts' },
 *       shared: { react: 'https://shell.example/@atoll-shared/react@18.3.1.js' },
 *       manifest: { requires: { react: '^18' } },
 *     }),
 *   ],
 *   build: { lib: { entry: 'src/mfe/checkout.app.ts', formats: ['es'] } },
 * });
 * ```
 *
 * Pair it with the host app's own build using the same `shared` map (or a
 * checked-in `shared.lock`-style JSON both configs read) — the "controlled
 * environment" is both sides resolving to identical URLs.
 */
import type { Plugin } from 'vite';
import type { RemoteManifest } from './manifest';

export interface FederationPluginOptions {
  /** Remote publish name — stamped into the manifest. */
  name?: string;
  /**
   * App key → entry source path, for manifest `apps`. When omitted every
   * emitted entry chunk becomes an app keyed by its chunk name.
   */
  exposes?: Record<string, string>;
  /**
   * Shared dep specifier → absolute URL the realm dedupes on. Applied as
   * rollup `external` + `output.paths`: the import survives the build
   * verbatim and resolves at runtime inside the host's realm.
   */
  shared?: Record<string, string>;
  /** Manifest extras: file name (default `mfe.manifest.json`), version, requires. */
  manifest?: {
    fileName?: string;
    version?: string;
    requires?: Record<string, string>;
  };
}

export const atollFederation = (options: FederationPluginOptions = {}): Plugin => {
  const shared = options.shared ?? {};
  const sharedKeys = Object.keys(shared);
  const manifestFile = options.manifest?.fileName ?? 'mfe.manifest.json';

  return {
    name: 'atoll:federation',
    config() {
      if (sharedKeys.length === 0) return null;
      return {
        build: {
          rollupOptions: {
            external: sharedKeys,
            output: { paths: { ...shared } },
          },
        },
      };
    },
    generateBundle(_ctx, bundle) {
      const apps: Record<string, string> = {};
      const exposes = options.exposes;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
        const key =
          exposes !== undefined
            ? Object.keys(exposes).find((app) => {
                const src = exposes[app].replace(/\\/g, '/');
                const facade = (chunk.facadeModuleId ?? '').replace(/\\/g, '/');
                return facade === src || facade.endsWith(`/${src}`) || facade.endsWith(src);
              })
            : chunk.name;
        if (key !== undefined) apps[key] = `./${chunk.fileName}`;
      }
      const manifest: RemoteManifest = {
        name: options.name ?? 'remote',
        ...(options.manifest?.version !== undefined && { version: options.manifest.version }),
        apps,
        ...(options.manifest?.requires !== undefined && { requires: options.manifest.requires }),
      };
      this.emitFile({
        type: 'asset',
        fileName: manifestFile,
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
};

export default atollFederation;
