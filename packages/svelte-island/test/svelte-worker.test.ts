// @vitest-environment happy-dom
/**
 * `svelteIslandApp` — the Svelte 5 worker renderer: a compiled .svelte
 * component mounts into a instance's PROXY document and its mutations cross
 * as ops. In-process E2E like the sibling suite: real registry + op
 * protocol, the only fake being the thread boundary (InProcessWorker runs
 * the worker entry's defineMonoWorker in this module graph).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@jwhenry123/mesh/sdk/testing/inProcessWorker';
import type { IslandHandle } from '@jwhenry123/mesh-islands';
import { counterApp } from './fixtures/counter.worker';

vi.stubGlobal('Worker', InProcessWorker);
// In-process workers share one module graph — importing the entry performs
// its defineMonoWorker registration, exactly what a bundled worker does.
InProcessWorker.handlerModules = [() => import('./fixtures/counter.worker')];

let mountIsland: typeof import('@jwhenry123/mesh-islands').mountIsland;
let connectIslandWorker: typeof import('@jwhenry123/mesh-islands').connectIslandWorker;
// In-process artifact: a mounted instance can point the ambient `document` at
// its PROXY document (shared globalThis) — capture the real one before any
// mounts. Real browsers never share globals across threads.
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ connectIslandWorker, mountIsland } = await import('@jwhenry123/mesh-islands'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/counter.worker.ts', import.meta.url), { type: 'module' });

describe('svelteIslandApp', () => {
  it('mounts a compiled Svelte component, round-trips events, patches props, unmounts', async () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const emitted: Array<{ name: string; payload: unknown }> = [];

    const island: IslandHandle = await mountIsland({
      client: connectIslandWorker({ worker: renderWorker }),
      el: host,
      // islandApp() stamps the component-reference handle — mountIsland
      // takes the registry key it resolves to.
      app: counterApp.islandAppName,
      props: { label: 'islands' },
      onEvent: (name, payload) => emitted.push({ name, payload }),
    });

    // Mount → real DOM replayed from the worker's op stream. The component
    // body's 'ready' emit lands in the same batch.
    expect(host.querySelector('.lbl')?.textContent).toBe('islands: 0');
    expect(island.pid).toMatch(/^w-/);
    expect(
      emitted.some(
        (e) => e.name === 'ready' && (e.payload as { label: string }).label === 'islands',
      ),
    ).toBe(true);
    // The {#if} branch's comment anchor exists driver-side (an empty text
    // node — the wire has no comment op) but renders nothing yet.
    expect(host.querySelector('.pos')).toBeNull();

    // Click → dispatch → delegated handler runs the $state mutation → the
    // effect's DOM patch arrives via doorbell/flush.
    host.querySelector('.inc')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(host.querySelector('.lbl')?.textContent).toBe('islands: 1'));
    // The comment-anchored {#if} branch materialized.
    await vi.waitFor(() => expect(host.querySelector('.pos')?.textContent).toBe('positive'));

    // Second button → emit op → onEvent, carrying the post-increment state.
    host.querySelector('.tell')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() =>
      expect(
        emitted.some(
          (e) => e.name === 'clicked' && (e.payload as { n: number }).n === 1,
        ),
      ).toBe(true),
    );

    // updateProps → FINE-GRAINED patch: the $state-backed props box
    // invalidates only the label read — the same nodes are updated in
    // place, not rebuilt (no clear op, element identity preserved).
    const lbl = host.querySelector('.lbl')!;
    const counter = host.querySelector('.counter')!;
    await island.updateProps({ label: 'renamed' });
    expect(host.querySelector('.lbl')).toBe(lbl);
    expect(host.querySelector('.counter')).toBe(counter);
    expect(lbl.textContent).toBe('renamed: 1');

    // destroy → the island tears down; as the client's only mount its
    // worker terminates (the unmount op batch is dropped driver-side —
    // teardown is proven by termination, not by DOM removal).
    const worker = InProcessWorker.created.at(-1)!;
    island.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });
});
