// Functional test: a real vite dev server answering `?worker_file` requests
// through the atoll middleware — bundled output, COEP header echo, vite alias
// bridging, and watch → invalidate → full-reload.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { atoll } from '../src/index.ts';

const fixture = fileURLToPath(new URL('./fixture', import.meta.url));
const depPath = `${fixture}/src/dep.ts`;
const depUrl = `/@fs/${depPath.replace(/\\/g, '/')}`;

// Plugin-owned virtual modules — the `atoll-vite-load` fallback namespace in
// the esbuild bridge exists for these (no fs path; load hooks only).
const virtuals: Plugin = {
  name: 'atoll-test-virtuals',
  resolveId(id) {
    if (id === 'virtual:throws') throw new Error('resolve blew up');
    return id.startsWith('virtual:') ? `\0${id}` : null;
  },
  load(id) {
    if (id === '\0virtual:atoll-fixture')
      return `import { DEEP } from '/@id/__x00__virtual:dep';
              import { VALUE } from '${depUrl}';
              import { C } from '/@custom/thing';
              export const MSG = 'VIRTUAL-' + DEEP + '-' + VALUE + '-' + C;`;
    if (id === '\0virtual:dep') return `export const DEEP = 'DEEP_OK';`;
    if (id === '/@custom/thing') return `export const C = 'CUSTOM_OK';`;
    if (id === '\0virtual:sfc-link') return `import '${depUrl.replace('dep.ts', 'Widget.vue')}';`;
    return null;
  },
};

let server: ViteDevServer;
let base: string;

const workerUrl = () => `${base}/src/app.worker.ts?worker_file&type=module`;

beforeAll(async () => {
  server = await createServer({
    root: fixture,
    configFile: false,
    logLevel: 'silent',
    plugins: [virtuals, atoll()],
    resolve: {
      // Proves the esbuild bundle resolves through vite's plugin container —
      // a bare specifier the esbuild resolver alone could never satisfy.
      alias: [
        { find: /^virtual-dep$/, replacement: `${fixture}/src/aliased.ts` },
        // Bare specifier that resolves to an SFC — the fallback marker must
        // fire from the *resolved* path, not just the raw import.
        { find: /^widget-sfc$/, replacement: `${fixture}/src/Widget.vue` },
        // Workspace-style aliasing: @atolljs/devtools resolves to sources,
        // not node_modules — /__atoll/ must still find app/ (via
        // pluginContainer.resolveId, then ../app).
        {
          find: /^@atolljs\/devtools$/,
          replacement: `${fileURLToPath(new URL('../../devtools/src/index.ts', import.meta.url)).replace(/\\/g, '/')}`,
        },
      ],
    },
    server: {
      port: 0,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  });
  await server.listen();
  const addr = server.httpServer!.address();
  base = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await server.close();
  writeFileSync(depPath, `export const VALUE = 'DEP_V1';\n`);
});

describe('atoll vite plugin', () => {
  it('serves a bundled worker entry with vite config headers echoed', async () => {
    const res = await fetch(workerUrl());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript');
    // require-corp pages reject worker scripts that don't echo the embedder
    // policy — the middleware must carry server.headers onto the response.
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    const code = await res.text();
    // Bundled: the dep and the alias-resolved module are inlined…
    expect(code).toContain('DEP_V1');
    expect(code).toContain('ALIAS_OK');
    // …and nothing from vite's browser dev pipeline leaks into the worker.
    expect(code).not.toContain('/@vite/client');
    expect(code).not.toContain('/@react-refresh');
    expect(code).not.toContain('import.meta.hot');
  });

  it('bundles a worker entry outside the project root (/@fs/ URL)', async () => {
    // Workspace-linked packages produce /@fs/ entry URLs — the middleware
    // must unwrap the dev-URL prefix before resolving to a fs path.
    const fsUrl = `/@fs/${fixture}/src/app.worker.ts`.replace(/\\/g, '/');
    const res = await fetch(`${base}${fsUrl}?worker_file&type=module`);
    const code = await res.text();
    // The 500 body is the bundle error message — include it on failure.
    expect(res.status, code).toBe(200);
    expect(code).toContain('DEP_V1');
  });

  it('bundles a worker entry via a doubled-slash /@fs// URL', async () => {
    // /@fs/ + posix-absolute path emits '/@fs//home/…' on Linux/macOS —
    // unwrapping must collapse the doubled slash or esbuild reads it as a
    // protocol-relative URL and fails the build. (Same URL as the test
    // above on posix; distinct on Windows where it's '/@fs//C:/…'.)
    const fsUrl = `/@fs//${fixture}/src/app.worker.ts`.replace(/\\/g, '/');
    const res = await fetch(`${base}${fsUrl}?worker_file&type=module`);
    const code = await res.text();
    expect(res.status, code).toBe(200);
    expect(code).toContain('DEP_V1');
  });

  it('serves the devtools dashboard at /__atoll/ with the broadcast flag', async () => {
    const res = await fetch(`${base}/__atoll/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('atoll devtools');
    // The transport flag is injected — broadcast mode is what makes the
    // same-origin dashboard see this app's sessions.
    expect(html).toContain('__ATOLL_TRANSPORT');
  });

  it('redirects the extensionless /__atoll to the trailing-slash URL', async () => {
    const res = await fetch(`${base}/__atoll`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/__atoll/');
  });

  it('falls back to vite per-module serving for SFC worker graphs', async () => {
    const res = await fetch(`${base}/src/sfc.worker.ts?worker_file&type=module`);
    expect(res.status).toBe(200);
    const code = await res.text();
    // Vite's module transform keeps the SFC import live (rewritten specifier)
    // rather than esbuild-inlining it — proof the request hit `next()`.
    expect(code).toMatch(/import[^;]*Widget\.vue/);
    expect(code).not.toContain('__defProp'); // esbuild bundle prelude
  });

  it('bundles plugin-owned virtual modules via the plugin container', async () => {
    const res = await fetch(`${base}/src/virtual.worker.ts?worker_file&type=module`);
    expect(res.status).toBe(200);
    const code = await res.text();
    // `virtual:atoll-fixture` has no fs path — it only exists through
    // pluginContainer.load; its code then imports an `/@id/` nul-encoded
    // virtual dep and an `/@fs/` dev URL, both decoded back to real modules.
    expect(code).toContain('VIRTUAL-');
    expect(code).toContain('DEEP_OK');
    expect(code).toContain('DEP_V');
    expect(code).toContain('CUSTOM_OK');
  });

  it('falls back when a resolved specifier turns out to be an SFC', async () => {
    const res = await fetch(`${base}/src/sfc-alias.worker.ts?worker_file&type=module`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/import[^;]*widget-sfc|Widget\.vue/);
  });

  it('falls back when a dev-URL import points at an SFC', async () => {
    const res = await fetch(`${base}/src/sfc-fs.worker.ts?worker_file&type=module`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('virtual:sfc-link');
  });

  it('rewrites nested worker entries back onto the bundling path', async () => {
    const res = await fetch(`${base}/src/nested.worker.ts?worker_file&type=module`);
    expect(res.status).toBe(200);
    const code = await res.text();
    // The nested `new Worker(new URL('./sub.worker.ts', …))` spec resolves
    // against the bundle's served URL — it must be re-anchored to an
    // absolute /@fs/ path flagged ?worker_file.
    expect(code).toMatch(/\/@fs\/.+sub\.worker\.ts\?worker_file/);
    // …and that request bundles recursively through the same middleware.
    const sub = await fetch(`${base}/@fs/${fixture.replace(/\\/g, '/')}/src/sub.worker.ts?worker_file&type=module`);
    expect(sub.status, await sub.clone().text()).toBe(200);
    const subCode = await sub.text();
    expect(subCode).toContain('SUB_');
    expect(subCode).toContain('DEP_V');
  });

  it('returns 500 for a missing worker entry', async () => {
    const res = await fetch(`${base}/src/nope.worker.ts?worker_file&type=module`);
    expect(res.status).toBe(500);
  });

  it('returns 500 when a plugin module resolves but fails to load', async () => {
    const res = await fetch(`${base}/src/virtual-fail.worker.ts?worker_file&type=module`);
    expect(res.status).toBe(500);
  });

  it('returns 500 when vite resolution itself throws', async () => {
    const res = await fetch(`${base}/src/virtual-throw.worker.ts?worker_file&type=module`);
    expect(res.status).toBe(500);
  });

  it('invalidates and full-reloads when a worker dependency changes', async () => {
    const send = vi.spyOn(server.ws, 'send');
    writeFileSync(depPath, `export const VALUE = 'DEP_V2';\n`);
    await vi.waitFor(
      () => expect(send).toHaveBeenCalledWith({ type: 'full-reload' }),
      { timeout: 10_000 },
    );
    const res = await fetch(workerUrl());
    expect(await res.text()).toContain('DEP_V2');
    send.mockRestore();
  });
});
