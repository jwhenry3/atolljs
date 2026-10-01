/**
 * @atolljs/vite — dev-server plugin for Atoll worker entries.
 *
 * Vite's dev pipeline serves worker entries as per-module graphs, which means
 * every browser-oriented plugin transform (React fast-refresh, `/@vite/client`
 * hot-context injection, SFC HMR wrappers) also lands in code that runs inside
 * a Web Worker — where `window` doesn't exist. Worker-side HMR can't preserve
 * an island/pool anyway (a worker's module registry can't be partially
 * reloaded), so this plugin takes workers off that pipeline entirely:
 *
 *   `?worker_file` / `?sharedworker_file` requests are answered with a single
 *   esbuild bundle built once per entry, cached, and rebuilt whenever any file
 *   in its input graph changes — the watcher then sends a `full-reload` and
 *   the page respawns a fresh worker (the only meaningful worker HMR).
 *
 * Production builds are untouched: `apply: 'serve'` means `vite build` keeps
 * bundling workers through its normal pipeline.
 *
 * Worker graphs containing framework SFCs (.vue/.svelte) bail back to vite's
 * own per-module pipeline — those plugins need their own transforms and,
 * unlike plugin-react, don't inject window-bound code at module scope, so the
 * fallback is safe.
 *
 * Two invariants worth knowing (both discovered the hard way):
 *  - The worker script response must echo the page's embedder policy
 *    (`server.headers` — COOP/COEP). Under `require-corp`, Chrome refuses
 *    worker scripts that don't declare a compatible COEP
 *    (`net::ERR_BLOCKED_BY_RESPONSE`, surfaced as an opaque "worker error").
 *  - Resolution is bridged through `server.pluginContainer.resolveId`, so
 *    aliases, tsconfig paths, and plugin resolvers apply inside the worker
 *    bundle the same way they do on the main thread.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { Plugin as EsbuildPlugin } from 'esbuild';

export interface AtollViteOptions {
  /**
   * Extra `define` entries merged into every worker bundle. Applied after
   * vite's `config.define`, so these win ties.
   */
  define?: Record<string, string>;
  /**
   * JSX mode for worker entries compiled by esbuild. Defaults to `'automatic'`
   * (react-jsx). Pair with `jsxImportSource` for Solid/etc.
   */
  jsx?: 'transform' | 'preserve' | 'automatic';
  /** JSX import source for `jsx: 'automatic'` — e.g. `'solid-js'`. */
  jsxImportSource?: string;
}

interface WorkerBundle {
  code: string;
  /** Absolute paths of every file in the bundle's input graph. */
  inputs: Set<string>;
}

// vite emits `?worker_file` for `new Worker(new URL('./x.ts', import.meta.url))`
// and `?sharedworker_file` for SharedWorker — both are worker entry requests.
const WORKER_REQUEST = /(?:^|[?&])(?:shared)?worker_file(?:=|&|$)/;
// Style/asset imports inside a worker bundle resolve to an empty module —
// styles are a main-thread concern; the islands proxy DOM has no stylesheet.
const STUB_ASSET = /\.(?:css|s[ac]ss|less|styl|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|mp[34]|webm|wasm)(?:$|\?)/i;
// Inputs that need vite's own transform pipeline (framework SFCs, macro
// formats). A worker graph containing these can't be bundled by esbuild —
// the request falls back to vite's per-module serving, which is safe for
// those plugins (they don't inject window-bound code at module scope).
const NEEDS_VITE = /\.(?:vue|svelte|astro|md|mdx)(?:$|\?)/i;
// vite dev URLs that pull the browser HMR client / refresh runtime into the
// worker graph — replaced with an empty module (worker bundles get neither).
// `/@id/` is deliberately NOT here: it encodes real virtual modules, decoded
// and loaded through the plugin container below.
const VITE_DEV_INTERNAL = /^\/@(?:vite|react-refresh)\b/;
// vite dev resolves bare imports to prebundled dep chunks — their CJS
// interop wrappers don't expose statically-visible named exports to esbuild
// (e.g. `.vite/deps/react.js` exports only a `default`). Those ids are
// skipped so esbuild resolves the real package instead.
const OPTIMIZED_DEP = /(^|\/)node_modules\/\.vite\//;

/** Worker graphs needing vite's own transforms (framework SFCs etc.) bail to
 *  the per-module pipeline — esbuild wraps plugin errors, so the middleware
 *  detects this via the message marker, not instanceof. */
const FALLBACK_MARKER = 'atoll-fallback:';

const toPosix = (p: string) => p.replace(/\\/g, '/');

/** vite dev ids are posix paths, sometimes `/@fs/` or root-relative — unwrap to fs. */
function toFsPath(id: string, root: string): string {
  let p = id.split('?')[0];
  if (p.startsWith('/@fs/')) p = p.slice(4);
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // '/C:/x' → 'C:/x'
  if (isAbsolute(p)) return p;
  // Root-relative dev id ('/src/x.ts') or plain relative — try root first,
  // since that's how vite expresses project files.
  const fromRoot = resolve(root, p.startsWith('/') ? `.${p}` : p);
  return existsSync(fromRoot) || p.startsWith('/') ? fromRoot : resolve(root, p);
}

async function buildWorkerBundle(
  server: ViteDevServer,
  absEntry: string,
  format: 'esm' | 'iife',
  options: AtollViteOptions,
): Promise<WorkerBundle> {
  const esbuild = await import('esbuild');
  const root = server.config.root;

  const viteBridge: EsbuildPlugin = {
    name: 'atoll:vite-bridge',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        // Imports inside plugin-loaded virtual modules (atoll-vite-load)
        // resolve through the same bridge — their sources carry /@id/ and
        // /@fs/ dev URLs esbuild can't resolve natively.
        if (args.kind === 'entry-point') return undefined;
        if (args.namespace !== 'file' && args.namespace !== 'atoll-vite-load') return undefined;
        if (NEEDS_VITE.test(args.path)) {
          throw new Error(`${FALLBACK_MARKER} ${args.path}`);
        }
        if (VITE_DEV_INTERNAL.test(args.path)) return { path: args.path, namespace: 'atoll-empty' };
        if (STUB_ASSET.test(args.path)) return { path: args.path, namespace: 'atoll-empty' };
        // /@id/__x00__foo urls encode virtual module ids — decode and load
        // through the plugin container (they're real modules, not stubs).
        // Checked before the '/' dev-URL branch since /@id/ ids aren't paths.
        if (args.path.startsWith('/@id/')) {
          const vid = args.path.slice(5).replace(/__x00__/g, '\0').replace(/__x2E__/g, '.');
          if (NEEDS_VITE.test(vid)) throw new Error(`${FALLBACK_MARKER} ${vid}`);
          // Decoded ids can point at optimized-dep chunks — same CJS-interop
          // problem, so esbuild resolves the real package instead.
          if (OPTIMIZED_DEP.test(vid)) return undefined;
          return { path: vid, namespace: 'atoll-vite-load' };
        }
        // Leading-slash ids are dev URLs (root-relative, /@fs/) from code
        // vite already rewrote — resolve straight to the fs path. No
        // NEEDS_VITE re-check: the specifier's filename survives toFsPath
        // intact, so an SFC here already threw on the raw path above.
        if (args.path.startsWith('/')) {
          const abs = toFsPath(args.path, root);
          if (existsSync(abs)) return { path: abs };
          return { path: args.path, namespace: 'atoll-vite-load' };
        }
        // Bridge to vite resolution so aliases / tsconfig paths / plugin
        // resolvers apply identically to the app graph.
        const resolved = await server.pluginContainer
          .resolveId(args.path, args.importer || absEntry)
          .catch(() => null);
        if (!resolved || resolved.external) return undefined;
        const file = toPosix(resolved.id.split('?')[0]);
        if (NEEDS_VITE.test(file)) {
          throw new Error(`${FALLBACK_MARKER} ${file}`);
        }
        if (VITE_DEV_INTERNAL.test(file)) return { path: file, namespace: 'atoll-empty' };
        if (STUB_ASSET.test(file)) return { path: file, namespace: 'atoll-empty' };
        if (OPTIMIZED_DEP.test(file)) return undefined;
        const abs = toFsPath(file, root);
        if (existsSync(abs)) return { path: abs };
        // Virtual / plugin-owned module — no fs path; load through vite's
        // plugin container (load hooks only — no browser-side transforms).
        return { path: file, namespace: 'atoll-vite-load' };
      });

      build.onLoad({ filter: /.*/, namespace: 'atoll-empty' }, () => ({
        // createHotContext is what vite injects imports for — returning
        // undefined leaves `import.meta.hot` falsy so HMR blocks stay inert.
        contents: 'export default undefined; export const createHotContext = () => undefined;',
        loader: 'js',
      }));

      // Plugin-owned (virtual) modules — load hooks only, no transform, so
      // nothing browser-bound is injected.
      build.onLoad({ filter: /.*/, namespace: 'atoll-vite-load' }, async (args) => {
        const loaded = await server.pluginContainer.load(args.path);
        if (!loaded) throw new Error(`vite could not load ${args.path}`);
        const code = typeof loaded === 'string' ? loaded : loaded.code;
        return { contents: code, loader: 'js' };
      });
    },
  };

  // vite's config.define tolerates booleans/numbers; esbuild wants string
  // literals — normalize non-strings to their JSON form.
  const asDefineValue = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  const defines: Record<string, string> = {
    'import.meta.env.MODE': JSON.stringify(server.config.mode ?? 'development'),
    'import.meta.env.DEV': 'true',
    'import.meta.env.PROD': 'false',
    'import.meta.env.SSR': 'false',
    'import.meta.env.BASE_URL': JSON.stringify(server.config.base ?? '/'),
    'import.meta.hot': 'false',
    'process.env.NODE_ENV': '"development"',
  };
  for (const [k, v] of Object.entries(server.config.define ?? {})) defines[k] = asDefineValue(v);
  for (const [k, v] of Object.entries(options.define ?? {})) defines[k] = v;

  const out = await esbuild.build({
    entryPoints: [absEntry],
    bundle: true,
    format,
    platform: 'browser',
    target: 'es2022',
    absWorkingDir: root,
    write: false,
    metafile: true,
    sourcemap: 'inline',
    logLevel: 'silent',
    define: defines,
    jsx: options.jsx ?? 'automatic',
    jsxImportSource: options.jsxImportSource,
    jsxDev: true,
    plugins: [viteBridge],
  });

  const inputs = new Set(
    Object.keys(out.metafile!.inputs).map((i) => resolve(root, i)),
  );
  inputs.add(absEntry);
  return { code: out.outputFiles[0].text, inputs };
}

/**
 * Dev-only vite plugin: serves worker entries (`new Worker(new URL(...))`) as
 * esbuild bundles instead of vite's per-module dev graph, and full-reloads the
 * page when any worker dependency changes.
 */
export function atoll(options: AtollViteOptions = {}): Plugin {
  const cache = new Map<string, Promise<WorkerBundle>>();

  return {
    name: 'atoll:vite',
    apply: 'serve',

    configureServer(server) {
      // Intercepts BEFORE vite's transform middleware — worker entries never
      // enter the per-module pipeline, so no browser plugin (react refresh,
      // hot-context, SFC HMR) can leak into the worker graph.
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' || !req.url || !WORKER_REQUEST.test(req.url)) return next();

        const url = new URL(req.url, 'http://localhost');
        const pathname = decodeURIComponent(url.pathname);
        const absEntry = resolve(server.config.root, pathname.replace(/^[\\/]+/, ''));
        const format = url.searchParams.get('type') === 'classic' ? 'iife' : 'esm';
        const key = `${format}:${absEntry}`;

        try {
          let pending = cache.get(key);
          if (!pending) {
            pending = buildWorkerBundle(server, absEntry, format, options);
            cache.set(key, pending);
            pending.catch(() => cache.delete(key));
          }
          const bundle = await pending;
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Cache-Control', 'no-cache');
          // Worker script responses must echo the page's COOP/COEP or Chrome
          // blocks the fetch under require-corp (ERR_BLOCKED_BY_RESPONSE).
          for (const [k, v] of Object.entries(server.config.server.headers ?? {})) {
            if (v !== undefined) res.setHeader(k, v);
          }
          res.end(bundle.code);
        } catch (e) {
          // Worker graph needs vite's own transforms (framework SFCs etc.) —
          // hand it back to the per-module pipeline.
          if ((e as Error).message?.includes(FALLBACK_MARKER)) return next();
          const err = e as Error;
          server.config.logger.error(`[atoll] worker bundle failed for ${pathname}: ${err.message}`);
          server.ws.send({
            type: 'error',
            err: { message: `atoll: worker bundle failed\n${pathname}\n\n${err.message}`, stack: err.stack ?? '' },
          });
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain');
          res.end(String(err.message ?? err));
        }
      });

      const invalidate = (file: string) => {
        const abs = resolve(file);
        for (const [key, pending] of cache) {
          void pending.then(
            (bundle) => {
              if (bundle.inputs.has(abs)) {
                cache.delete(key);
                server.ws.send({ type: 'full-reload' });
              }
            },
            () => {},
          );
        }
      };
      server.watcher.on('change', invalidate);
      server.watcher.on('unlink', invalidate);
    },
  };
}

export default atoll;
