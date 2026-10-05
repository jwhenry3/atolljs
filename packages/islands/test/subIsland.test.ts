// @vitest-environment happy-dom
/**
 * Nested-island coverage: `mountIsland` handed a proxy element mounts a
 * child island into the parent instance's shadow tree — its ops replay
 * into proxy nodes and tunnel upward through the outer island's own op
 * stream onto the real DOM. Same function, same options as a top-level
 * mount; the target picks the driver.
 *
 * In-process: the "outer worker" and "sub-worker" share the TaskRegistry,
 * so every hop (outer driver → proxy DOM → sub-driver → sub ops → outer
 * queue → real DOM) is exercised except the actual OS threads.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { IslandHandle } from '../src/index';
import { hostRef } from './fixtures/subOuter.worker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/subOuter.worker'),
  () => import('./fixtures/subInner.worker'),
];

let mountIsland: typeof import('../src/index').mountIsland;
let connectIslandWorker: typeof import('../src/index').connectIslandWorker;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ mountIsland, connectIslandWorker } = await import('../src/index'));
  // Importing the worker entry registers the sub-mounter — the same load
  // path a real worker takes (every island worker imports it).
  await import('../src/worker/index');
});

const outerWorker = () =>
  new Worker(new URL('./fixtures/subOuter.worker.ts', import.meta.url), { type: 'module' });
const innerWorker = () =>
  new Worker(new URL('./fixtures/subInner.worker.ts', import.meta.url), { type: 'module' });

function host(): HTMLElement {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
}

/** Mount an outer island and return it + the proxy host inside its shadow tree. */
async function outerIsland(el: HTMLElement): Promise<IslandHandle> {
  const island = await mountIsland({ worker: outerWorker, el, app: 'subouter' });
  if (hostRef.el === null) throw new Error('fixture did not stash .sub-host');
  return island;
}

describe('mountIsland into a proxy element (nested island)', () => {
  it('mounts a sub-island into a proxy element; its DOM reaches the page through the outer island', async () => {
    const el = host();
    const island = await outerIsland(el);
    const sub = await mountIsland({
      el: hostRef.el!,
      worker: innerWorker,
      app: 'inner',
      props: { label: 'nest' },
    });

    // The mount ops are already applied to the proxy tree — draining the
    // outer instance's queue replays them onto the real DOM.
    await island.flush();
    const inner = el.querySelector('.inner')!;
    expect(inner).not.toBeNull();
    expect(el.querySelector('.sub-host')!.contains(inner)).toBe(true);
    expect(inner.querySelector('.inner-label')!.textContent).toBe('nest:0');
    expect(sub.instance).toMatch(/^subouter@\d+~inner@\d+$/);
    expect(sub.pid).not.toBe('unmounted');

    island.destroy();
    sub.destroy();
  });

  it('routes real-DOM events down through the proxy listener chain, and emits back up', async () => {
    const el = host();
    const island = await outerIsland(el);
    const events: Array<[string, unknown]> = [];
    const sub = await mountIsland({
      el: hostRef.el!,
      worker: innerWorker,
      app: 'inner',
      props: { label: 'clk' },
      onEvent: (name, payload) => events.push([name, payload]),
    });
    await island.flush();

    // Real click → outer driver dispatch → proxy listener → sub dispatch →
    // sub handler mutates + emits → ops ride back up through the outer queue.
    el.querySelector<HTMLButtonElement>('.inner-btn')!.dispatchEvent(
      new (realDoc.defaultView as typeof window).MouseEvent('click', { bubbles: true }),
    );
    await vi.waitFor(() => expect(events.length).toBe(1));
    expect(events[0]).toEqual(['inner-tick', { n: 1 }]);

    await island.flush();
    expect(el.querySelector('.inner-label')!.textContent).toBe('clk:1');

    island.destroy();
    sub.destroy();
  });

  it('updateProps reaches the sub-app; a shared client keeps its sub-worker alive for siblings', async () => {
    const elA = host();
    const elB = host();
    const islandA = await mountIsland({ worker: outerWorker, el: elA, app: 'subouter' });
    const hostA = hostRef.el!;
    const islandB = await mountIsland({ worker: outerWorker, el: elB, app: 'subouter' });
    const hostB = hostRef.el!;

    const shared = connectIslandWorker({ worker: innerWorker });
    const subA = await mountIsland({
      el: hostA, client: shared, app: 'inner', props: { label: 'a' },
    });
    const subB: IslandHandle = await mountIsland({
      el: hostB, client: shared, app: 'inner', props: { label: 'b' },
    });
    await islandA.flush();
    await islandB.flush();
    expect(elA.querySelector('.inner-label')!.textContent).toBe('a:0');
    expect(elB.querySelector('.inner-label')!.textContent).toBe('b:0');

    // Props flow through the nested update path.
    await subA.updateProps({ label: 'a2' });
    // updateProps rebuilds the imperative app — the change shows after flush.
    await islandA.flush();
    await islandB.flush();
    expect(elA.querySelector('.inner-label')!.textContent).toBe('a2:0');
    expect(elB.querySelector('.inner-label')!.textContent).toBe('b:0');

    // Shared client: first destroy unmounts but leaves the sub-worker up.
    subA.destroy();
    expect(InProcessWorker.created.at(-1)!.terminated).toBe(false);
    subB.destroy();

    islandA.destroy();
    islandB.destroy();
  });

  it('push mode: sub-island ops ring the outer doorbell and reach the page without manual flush', async () => {
    // Regression: each pool's INIT_MEMORY rebinds every defined contract in
    // this module graph, so the outer island's doorbell observe must re-arm
    // on the rebound buffer — otherwise nested ops queue but never drain.
    const el = host();
    const island = await mountIsland({ worker: outerWorker, el, app: 'subouter', mode: 'push' });
    if (hostRef.el === null) throw new Error('fixture did not stash .sub-host');
    const sub = await mountIsland({
      el: hostRef.el,
      worker: innerWorker,
      app: 'inner',
      props: { label: 'push' },
    });

    await vi.waitFor(() => {
      expect(el.querySelector('.inner-label')!.textContent).toBe('push:0');
    });
    island.destroy();
    sub.destroy();
  });

  it('slots: a nested mount claims the names it lists; the rest bubble to the outer island', async () => {
    const el = host();
    const outerSlots: Array<HTMLElement | null> = [];
    const island = await mountIsland({
      worker: outerWorker,
      el,
      app: 'subouter',
      slots: { free: (e) => outerSlots.push(e) },
    });
    const nestedSlots: Array<HTMLElement | null> = [];
    const sub = await mountIsland({
      el: hostRef.el!,
      worker: innerWorker,
      app: 'inner',
      slots: { badge: (e) => nestedSlots.push(e) },
    });
    // The nested mount gets the anchor's proxy element, renamed so the
    // page-side driver never claims it a second time.
    expect(nestedSlots).toHaveLength(1);
    expect(nestedSlots[0]!.getAttribute('data-atoll-sub-slot')).toBe('badge');

    await island.flush();
    expect(el.querySelector('[data-atoll-sub-slot="badge"]')).not.toBeNull();
    expect(el.querySelector('[data-atoll-slot="badge"]')).toBeNull();
    // 'free' was not listed, so it reached the outer island's slots as real DOM.
    expect(outerSlots).toHaveLength(1);
    expect(outerSlots[0]).toBe(el.querySelector('[data-atoll-slot="free"]'));

    sub.destroy();
    expect(nestedSlots.at(-1)).toBeNull();
    island.destroy();
  });

  it('destroy releases the sub-worker it owns and stops forwarding', async () => {
    const el = host();
    const island = await outerIsland(el);
    const sub = await mountIsland({ el: hostRef.el!, worker: innerWorker, app: 'inner' });
    await island.flush();
    expect(el.querySelector('.inner-btn')).not.toBeNull();

    const spawned = InProcessWorker.created.at(-1)!;
    sub.destroy();
    expect(spawned.terminated).toBe(true);
    island.destroy();
  });
});
