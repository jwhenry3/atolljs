// @vitest-environment happy-dom
/**
 * defineWorkers lifecycle coverage: remount paths for all three instance
 * kinds, the rendered-app contract (mount → handle.update → dispose),
 * updateProps-on-unmounted errors, mono-worker registration, and React
 * renderer internals — Suspense hide/unhide and portal insertion.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { IslandHandle } from '../src/index';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/perf.worker'),
  () => import('./fixtures/mono.worker'),
];

let mountIsland: typeof import('../src/index').mountIsland;
let connectIslandWorker: typeof import('../src/index').connectIslandWorker;
let suspendControl: typeof import('./fixtures/perf.worker').suspendControl;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ mountIsland, connectIslandWorker } = await import('../src/index'));
  ({ suspendControl } = await import('./fixtures/perf.worker'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/perf.worker.ts', import.meta.url), { type: 'module' });

function host(): HTMLElement {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
}

describe('rendered (non-React framework) instances', () => {
  it('mounts via the proxy doc, patches via handle.update, disposes on destroy', async () => {
    const el = host();
    const island = await mountIsland({ worker: renderWorker, el, app: 'rendered', props: { v: 1 } });
    expect(el.querySelector('.rendered')?.textContent).toBe('v1');

    // Fine-grained update — the handle patches its own tree, no rebuild.
    await island.updateProps({ v: 2 });
    expect(el.querySelector('.rendered')?.textContent).toBe('v2');
    island.destroy();
  });

  it('updateProps falls back to rebuild when the handle has no update', async () => {
    const el = host();
    const island = await mountIsland({
      worker: renderWorker,
      el,
      app: 'renderednu',
      props: { v: 1 },
    });
    expect(el.querySelector('.rendered-nu')?.textContent).toBe('nu-1');
    await island.updateProps({ v: 9 });
    // Rebuild semantics: a clear op + fresh mount — the text is v9.
    expect(el.querySelector('.rendered-nu')?.textContent).toBe('nu-9');
    island.destroy();
  });
});

describe('remount paths (same instance key mounted twice)', () => {
  it('imperative remount rebuilds on a fresh document', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    const first = await client.mount('tree@R', { rows: 3 });
    const second = await client.mount('tree@R', { rows: 1 });
    // Remount = clear + rebuild — the second batch leads with 'clear'.
    expect(second.some((o) => o.t === 'clear')).toBe(true);
    expect(second.filter((o) => o.t === 'create').length).toBeLessThan(
      first.filter((o) => o.t === 'create').length,
    );
    client.terminate();
  });

  it('rendered remount disposes the old handle then re-mounts', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    await client.mount('rendered@R', { v: 1 });
    const ops = await client.mount('rendered@R', { v: 2 });
    expect(ops.some((o) => o.t === 'clear')).toBe(true);
    client.terminate();
  });

  it('React remount unmounts the tree then renders into a fresh container', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    await client.mount('rcounter@R', {});
    const pidBefore = await client.whoami('rcounter@R');
    const ops = await client.mount('rcounter@R', {});
    const pidAfter = await client.whoami('rcounter@R');
    // pid survives a remount; the old tree's instances are detached.
    expect(pidAfter).toBe(pidBefore);
    expect(ops.length).toBeGreaterThan(0);
    client.terminate();
  });
});

describe('worker error surfaces', () => {
  it('updateProps on an unmounted instance rejects with a named error', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    await expect(client.updateProps('ghost@1', {})).rejects.toThrow(/not mounted/);
    client.terminate();
  });

  it('whoami reports unmounted for unknown instances; dispatch on a dead handler no-ops', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    expect(await client.whoami('ghost@1')).toBe('unmounted');
    expect(await client.dispatch(999_999, { type: 'click' })).toEqual([]);
    client.terminate();
  });
});

describe('mono worker', () => {
  it('defineMonoWorker registers its stamped app and mounts it', async () => {
    const el = host();
    const island = await mountIsland({ worker: renderWorker, el, app: 'mono' });
    expect(el.querySelector('.mono')?.textContent).toBe('mono island');
    island.destroy();
  });
});

describe('React renderer internals', () => {
  it('portal content lands inside the proxy-element target; reorder uses before ops', async () => {
    const el = host();
    const island = await mountIsland({ worker: renderWorker, el, app: 'rportal', props: { order: 'ab' } });
    // The ref drives setTarget → a second commit beamed the portal child
    // into .portal-target through the ProxyElement container path.
    await vi.waitFor(() => {
      expect(el.querySelector('.portal-target .beamed')?.textContent).toBe('beamed');
    });
    expect(el.querySelectorAll('.reorder li').item(0).textContent).toBe('a');

    // Reordering keyed children emits `before` ops — insertBefore.
    await island.updateProps({ order: 'ba' });
    const items = el.querySelectorAll('.reorder li');
    expect(items.item(0).textContent).toBe('b');
    expect(items.item(1).textContent).toBe('a');
    island.destroy();
  });

  it('Suspense: an update that suspends hides content, resolving unhides it', async () => {
    const el = host();
    const island: IslandHandle = await mountIsland({
      worker: renderWorker,
      el,
      app: 'rsuspend',
      props: { suspend: false },
    });
    expect(el.querySelector('.real')?.textContent).toBe('real content');

    // Suspends on update — the boundary hides its content, shows fallback.
    await island.updateProps({ suspend: true });
    await vi.waitFor(() => expect(el.querySelector('.fb')).not.toBeNull());

    // Releasing the gate lets React retry — fallback swaps back to content.
    suspendControl.release();
    await vi.waitFor(() =>
      expect(el.querySelector('.real')?.textContent).toBe('real content'),
    );
    island.destroy();
  });
});
