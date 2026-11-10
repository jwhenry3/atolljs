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

beforeAll(async () => {
  ({ connectFederation, satisfiesVersion, useShared, sharedDeps, parseRemoteManifest } =
    await import('../src/index'));
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
  });
});
