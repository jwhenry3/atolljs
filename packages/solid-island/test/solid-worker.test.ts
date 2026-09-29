// @vitest-environment happy-dom
/**
 * The Solid worker renderer (`solidIslandApp`) end-to-end — a rendered-instance
 * app written with the package's own primitives, driven through the real op
 * protocol. InProcessWorker fakes only the thread boundary: mount/dispatch/
 * updateProps ops replay onto real DOM here exactly as they do in a browser.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import {
  connectIslandWorker,
  mountIsland,
} from '@atolljs/islands';

vi.stubGlobal('Worker', InProcessWorker);
// Importing the fixture performs defineMonoWorker's registration side
// effects — what a bundled worker entry does at boot.
InProcessWorker.handlerModules = [() => import('./fixtures/counter.worker')];

// In-process artifact: once a instance mounts, ambient `document` can resolve
// to its PROXY document — capture the real one before any mounts.
let realDoc: Document;
beforeAll(() => {
  realDoc = document;
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/counter.worker.ts', import.meta.url), { type: 'module' });

describe('solid worker renderer', () => {
  it('mounts real DOM, signal-updates on click, patches props without rebuild, emits, unmounts', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const emitted: Array<{ name: string; payload: unknown }> = [];

    const client = connectIslandWorker({ worker: renderWorker });
    const island = await mountIsland({
      client,
      el,
      app: 'counter',
      props: { label: 'count' },
      onEvent: (name, payload) => emitted.push({ name, payload }),
    });

    // Mount: component output arrives as ordinary create/append/attr ops.
    expect(el.querySelector('.counter')).not.toBeNull();
    expect(el.querySelector('.count')?.textContent).toBe('count: 0');
    expect(el.querySelector('.bump')?.textContent).toBe('bump');
    expect(island.pid).toMatch(/^w-/);
    // The component-body emit rode back in the mount batch → onEvent.
    expect(emitted.some((e) => e.name === 'ready')).toBe(true);
    expect(emitted.find((e) => e.name === 'ready')?.payload).toEqual({ label: 'count' });

    // Click → listen op's dispatch → createSignal update → utext op.
    el.querySelector('.bump')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() =>
      expect(el.querySelector('.count')?.textContent).toBe('count: 1'),
    );
    expect(emitted.find((e) => e.name === 'bumped')?.payload).toEqual({ count: 1 });

    // updateProps → the props proxy's key-signal bumps — a fine-grained
    // patch: same nodes, changed text; NO clear/create rebuild.
    const wrap = el.querySelector('.counter');
    const span = el.querySelector('.count');
    await island.updateProps({ label: 'score' });
    expect(el.querySelector('.counter')).toBe(wrap);
    expect(el.querySelector('.count')).toBe(span);
    expect(el.querySelector('.count')?.textContent).toBe('score: 1');

    // A second click still lands — the live tree stayed mounted.
    el.querySelector('.bump')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() =>
      expect(el.querySelector('.count')?.textContent).toBe('score: 2'),
    );

    // Teardown: instance unmount → Solid root disposed → worker terminates.
    const worker = InProcessWorker.created.at(-1)!;
    island.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });
});
