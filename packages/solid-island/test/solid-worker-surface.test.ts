// @vitest-environment happy-dom
/**
 * Renderer-surface coverage for the Solid worker renderer — the paths
 * `insert`'s expression dispatcher reaches: accessor-branch replacement
 * (Show-style), `reconcileArrays` on a reordered `mapArray` output, and
 * key-level wire-prop granularity on `updateProps`. All driven through the
 * real op protocol via the registry worker in `surface.worker.ts`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '../../../test/inProcessWorker';
import {
  connectIslandWorker,
  mountIsland,
} from '@jwhenry123/mesh-worker-dom';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/surface.worker')];

// In-process artifact: capture the real document before a realm's proxy
// document can claim the ambient global.
let realDoc: Document;
beforeAll(() => {
  realDoc = document;
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/surface.worker.ts', import.meta.url), { type: 'module' });

const textOf = (el: Element, sel: string) =>
  [...el.querySelectorAll(sel)].map((n) => n.textContent);

describe('solid worker renderer — insertion surface', () => {
  it('accessor branches swap elements in place (Show-style conditional)', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const client = connectIslandWorker({ worker: renderWorker });
    const island = await mountIsland({ client, el, app: 'conditional' });

    expect(el.querySelector('.yes')?.textContent).toBe('YES');
    expect(el.querySelector('.no')).toBeNull();
    const toggle = el.querySelector('.toggle');

    // Click → dispatch → signal flip → the tracked accessor re-evals and
    // insertExpression REPLACES the branch node (not a subtree rebuild).
    toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.querySelector('.no')?.textContent).toBe('NO');
      expect(el.querySelector('.yes')).toBeNull();
    });
    // The static siblings are untouched by the branch swap.
    expect(el.querySelector('.toggle')).toBe(toggle);

    toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.querySelector('.yes')?.textContent).toBe('YES');
      expect(el.querySelector('.no')).toBeNull();
    });

    island.destroy();
  });

  it('a reordered signal array MOVES nodes through reconcileArrays', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const client = connectIslandWorker({ worker: renderWorker });
    const island = await mountIsland({ client, el, app: 'reorder' });

    expect(textOf(el, '.list li')).toEqual(['a', 'b', 'c']);
    // mapArray's per-item cache means each li keeps one node identity —
    // capture it to prove the reorder is a move, not re-creation.
    const liA = el.querySelector('.li-a');
    const liC = el.querySelector('.li-c');

    el.querySelector('.rev')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(textOf(el, '.list li')).toEqual(['c', 'b', 'a']));

    // Same DOM nodes, new positions — reconcileArrays emitted insertBefores,
    // not create+append pairs.
    expect(el.querySelectorAll('.list li')[0]).toBe(liC);
    expect(el.querySelectorAll('.list li')[2]).toBe(liA);

    // A second reversal restores order — still the same three nodes.
    el.querySelector('.rev')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(textOf(el, '.list li')).toEqual(['a', 'b', 'c']));
    expect(el.querySelector('.li-a')).toBe(liA);

    island.destroy();
  });

  it('updateProps re-runs only the changed prop key\'s dependents', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const emitted: Array<{ name: string; payload: unknown }> = [];
    const client = connectIslandWorker({ worker: renderWorker });
    const island = await mountIsland({
      client,
      el,
      app: 'proppatch',
      props: { a: 'a0', b: 'b0' },
      onEvent: (name, payload) => emitted.push({ name, payload }),
    });

    expect(el.querySelector('.pa')?.textContent).toBe('a0');
    expect(el.querySelector('.pb')?.textContent).toBe('b0');
    // Both bindings evaluated once at mount.
    expect(emitted.filter((e) => e.name === 'eval-a')).toHaveLength(1);
    expect(emitted.filter((e) => e.name === 'eval-b')).toHaveLength(1);

    // Change ONLY 'a' — b's signal sets the identical value, so Solid's
    // === equality suppresses notification: eval-b must NOT re-fire.
    await island.updateProps({ a: 'a1', b: 'b0' });
    expect(el.querySelector('.pa')?.textContent).toBe('a1');
    expect(el.querySelector('.pb')?.textContent).toBe('b0');
    await vi.waitFor(() =>
      expect(emitted.filter((e) => e.name === 'eval-a')).toHaveLength(2),
    );
    expect(emitted.filter((e) => e.name === 'eval-b')).toHaveLength(1);

    // Both changed → both bindings re-eval — still a patch (same nodes).
    const spanA = el.querySelector('.pa');
    await island.updateProps({ a: 'a2', b: 'b1' });
    await vi.waitFor(() =>
      expect(emitted.filter((e) => e.name === 'eval-b')).toHaveLength(2),
    );
    expect(el.querySelector('.pa')?.textContent).toBe('a2');
    expect(el.querySelector('.pb')?.textContent).toBe('b1');
    expect(el.querySelector('.pa')).toBe(spanA);

    island.destroy();
  });
});
