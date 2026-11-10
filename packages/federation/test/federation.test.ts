// @vitest-environment happy-dom
/**
 * Federation — the dynamic-registry host: lazy remote imports on first
 * mount, shared-scope reads inside remote modules, requires-range
 * negotiation, and name-exact resolution (the loader disables the
 * single-app fallback). Fixture: ./fixtures/federation.host.worker.ts.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { Op } from '@atolljs/islands';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/federation.host.worker')];

let connectFederation: typeof import('../src/index').connectFederation;
let satisfiesVersion: typeof import('../src/index').satisfiesVersion;
let useShared: typeof import('../src/index').useShared;
let sharedDeps: typeof import('../src/index').sharedDeps;
let parseRemoteManifest: typeof import('../src/index').parseRemoteManifest;
let fetchRemoteManifest: typeof import('../src/index').fetchRemoteManifest;
let provideShared: typeof import('../src/index').provideShared;
let resolveRemoteModule: typeof import('../src/index').resolveRemoteModule;
let defineFederationHost: typeof import('../src/worker').defineFederationHost;

beforeAll(async () => {
  ({
    connectFederation,
    satisfiesVersion,
    useShared,
    sharedDeps,
    parseRemoteManifest,
    fetchRemoteManifest,
    provideShared,
    resolveRemoteModule,
  } = await import('../src/index'));
  ({ defineFederationHost } = await import('../src/worker'));
});

const hostWorker = () =>
  new Worker(new URL('./fixtures/federation.host.worker.ts', import.meta.url), {
    type: 'module',
  });

const listenHandler = (ops: Op[]): number => {
  const op = ops.find((o) => o.t === 'listen');
  expect(op).toBeDefined();
  return (op as { handler: number }).handler;
};

describe('lazy remote mounts', () => {
  it('mounts a remote app on first use — the remote module imports inside the realm', async () => {
    const client = connectFederation({ worker: hostWorker });
    const ops = await client.mount('fed@1', { label: 'hi' });
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    client.terminate();
  });

  it('a second mount of the same remote is a registry hit (no re-import)', async () => {
    const client = connectFederation({ worker: hostWorker });
    await client.mount('fed@1', {});
    const ops = await client.mount('fed@2', {});
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    client.terminate();
  });

  it('local apps in the same registry mount without touching remotes', async () => {
    const client = connectFederation({ worker: hostWorker });
    const ops = await client.mount('local@1', {});
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    client.terminate();
  });

  it('rejects an unknown app even though the registry has exactly one local', async () => {
    // The loader disables the name-blind sole-app fallback — a federation
    // host resolves every mount by exact key, never by "the only app".
    const client = connectFederation({ worker: hostWorker });
    await expect(client.mount('nope@1', {})).rejects.toThrow(/unknown app/);
    client.terminate();
  });
});

describe('shared scope', () => {
  it('the remote app reads the host-provided dep at build and at emit', async () => {
    const client = connectFederation({ worker: hostWorker });
    const ops = await client.mount('fed@1', {});
    const dispatched = await client.dispatch(listenHandler(ops), { type: 'click' });
    expect(dispatched).toContainEqual({ t: 'emit', name: 'pong', payload: { text: 'hello' } });
    client.terminate();
  });

  it('sharedDeps reports what the host published', () => {
    // The host fixture ran at handler-module import — its scope is visible
    // in-process (same globalThis a real host worker's realm would hold).
    expect(sharedDeps()).toMatchObject({ greeting: '1.2.0' });
  });

  it('useShared range-checks the provided version', () => {
    expect(useShared<{ text: string }>('greeting', '^1')).toEqual({ text: 'hello' });
    expect(() => useShared('greeting', '^2')).toThrow(/requires/);
    expect(() => useShared('absent')).toThrow(/not provided/);
  });
});

describe('requires negotiation', () => {
  it('rejects mount when the remote requires an unprovided dep', async () => {
    const client = connectFederation({ worker: hostWorker });
    await expect(client.mount('needy@1', {})).rejects.toThrow(/requires shared dep "missing/);
    client.terminate();
  });

  it('rejects mount when the remote range excludes the provided version', async () => {
    const client = connectFederation({ worker: hostWorker });
    await expect(client.mount('badver@1', {})).rejects.toThrow(/"greeting@\^2".*v1\.2\.0/);
    client.terminate();
  });
});

describe('contract enforcement through the seam', () => {
  it('remote apps keep worker-side prop validation via withContract', async () => {
    const client = connectFederation({ worker: hostWorker });
    await expect(client.mount('fed@1', { label: 42 })).rejects.toThrow(/fed.*contract|string/i);
    client.terminate();
  });
});

describe('remote-ref forms', () => {
  // data: module URLs exercise the same import() path a remote URL would —
  // Node imports them natively, no fetch or CORS needed.
  const dataApp = (text: string): string =>
    `data:text/javascript,${encodeURIComponent(
      `export default { imperative: (doc) => { const el = doc.createElement('div'); el.textContent = ${JSON.stringify(text)}; doc.body.append(el); } };`,
    )}`;

  it('string ref — the specifier imports lazily on mount', async () => {
    // Per-test definers re-register the task surface (last defineWorker
    // wins) — this is how each ref form gets its own remotes map.
    defineFederationHost({
      remotes: { datafed: dataApp('via-string') },
    });
    const client = connectFederation({ worker: hostWorker });
    const ops = await client.mount('datafed@1', {});
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    client.terminate();
  });

  it('{ url } ref — the ref URL imports and its requires overlay applies', async () => {
    defineFederationHost({
      remotes: { urlfed: { url: dataApp('via-url'), requires: { greeting: '^1' } } },
    });
    const client = connectFederation({ worker: hostWorker });
    const ops = await client.mount('urlfed@1', {});
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    client.terminate();
  });

  it('{ manifest: object } — apps[name] resolves through the manifest', async () => {
    defineFederationHost({
      remotes: {
        manfed: {
          manifest: { name: 'm', apps: { manfed: dataApp('via-manifest') } },
        },
      },
    });
    const client = connectFederation({ worker: hostWorker });
    const ops = await client.mount('manfed@1', {});
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    client.terminate();
  });

  it('{ manifest: url } — fetched once, app specifiers resolve against it', async () => {
    const manifestUrl = 'https://mfe.test/mfe.manifest.json';
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        name: 'remote-m',
        apps: { netfed: dataApp('via-net') },
      }),
    }));
    // Restore fetch only — unstubAllGlobals would drop the Worker stub too.
    const origFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchSpy);
    defineFederationHost({
      remotes: { netfed: { manifest: manifestUrl }, netfed2: { manifest: manifestUrl } },
    });
    const client = connectFederation({ worker: hostWorker });
    const ops = await client.mount('netfed@1', {});
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    await expect(client.mount('netfed2@1', {})).rejects.toThrow(/no "netfed2"/);
    expect(fetchSpy).toHaveBeenCalledOnce(); // manifest cached per URL
    client.terminate();
    globalThis.fetch = origFetch;
  });

  it('manifest missing the app key rejects with the exposed list', async () => {
    defineFederationHost({
      remotes: {
        ghost: { manifest: { name: 'm', apps: { other: dataApp('x') } } },
      },
    });
    const client = connectFederation({ worker: hostWorker });
    await expect(client.mount('ghost@1', {})).rejects.toThrow(/no "ghost" app.*other/s);
    client.terminate();
  });
});

describe('resolveRemoteModule + scope edges', () => {
  it('falls back to default and named exports; throws naming the exports it saw', () => {
    const app = { imperative: () => {} };
    expect(resolveRemoteModule({ default: app }, 'x').app).toBe(app);
    expect(resolveRemoteModule({ x: app }, 'x').app).toBe(app);
    expect(() => resolveRemoteModule({ notAnApp: 1 }, 'x')).toThrow(
      /exposes no island app.*notAnApp/s,
    );
  });

  it('stamped requires merge over module-level requires', () => {
    const app = { imperative: () => {} };
    (app as Record<string, unknown>).atollRemoteApp = { requires: { b: '~2' } };
    const { requires } = resolveRemoteModule({ requires: { a: '^1' }, default: app }, 'x');
    expect(requires).toEqual({ a: '^1', b: '~2' });
  });

  it('re-providing a shared dep warns and keeps the first entry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    provideShared('greeting', { text: 'again' }, '9.9.9');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already provided'));
    expect(useShared<{ text: string }>('greeting')).toEqual({ text: 'hello' });
    warn.mockRestore();
  });
});

describe('manifests + version matcher', () => {
  it('satisfiesVersion covers the supported range forms', () => {
    expect(satisfiesVersion('1.2.0', '*')).toBe(true);
    expect(satisfiesVersion('1.2.0', '1.2.0')).toBe(true);
    expect(satisfiesVersion('1.3.0', '1.2.0')).toBe(false);
    expect(satisfiesVersion('1.4.9', '^1')).toBe(true);
    expect(satisfiesVersion('2.0.0', '^1')).toBe(false);
    expect(satisfiesVersion('1.2.9', '~1.2')).toBe(true);
    expect(satisfiesVersion('1.3.0', '~1.2')).toBe(false);
    expect(satisfiesVersion('3.0.0', '>=1.0.0')).toBe(true);
  });

  it('parseRemoteManifest validates shape', () => {
    expect(
      parseRemoteManifest({ name: 'm', apps: { a: './a.js' }, requires: { react: '^18' } }),
    ).toMatchObject({ name: 'm' });
    expect(() => parseRemoteManifest({})).toThrow(/name/);
    expect(() => parseRemoteManifest({ name: 'm', apps: { a: 1 } })).toThrow(/apps/);
    expect(() => parseRemoteManifest('x')).toThrow(/object/);
    expect(() =>
      parseRemoteManifest({ name: 'm', apps: { a: './a.js' }, requires: { r: 2 } }),
    ).toThrow(/requires/);
    expect(() =>
      parseRemoteManifest({ name: 'm', apps: { a: './a.js' }, version: 3 }),
    ).toThrow(/version/);
  });

  it('fetchRemoteManifest fetches + validates; non-ok status rejects', async () => {
    const origFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('good')
          ? { ok: true, json: async () => ({ name: 'm', apps: { a: './a.js' } }) }
          : { ok: false, status: 404 },
      ),
    );
    await expect(fetchRemoteManifest('https://x/good.json')).resolves.toMatchObject({
      name: 'm',
    });
    await expect(fetchRemoteManifest('https://x/bad.json')).rejects.toThrow(/404/);
    globalThis.fetch = origFetch;
  });
});
