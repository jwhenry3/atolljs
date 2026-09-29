// @vitest-environment happy-dom
/**
 * Driver-surface coverage: mountIsland's op replay against real DOM.
 * The 'drive' fixture emits attr/style/remove/listen ops plus malformed ops
 * (missing ids) — the driver must log-and-skip those, not throw. The
 * 'rprops' React fixture reshapes its prop set across updateProps so the
 * update-op diff hits every setProp/removeProp branch.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/sdk/testing/inProcessWorker';
import type { IslandClient, IslandHandle } from '../src/index';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/perf.worker')];

let mountIsland: typeof import('../src/index').mountIsland;
let connectIslandWorker: typeof import('../src/index').connectIslandWorker;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ mountIsland, connectIslandWorker } = await import('../src/index'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/perf.worker.ts', import.meta.url), { type: 'module' });

function host(): HTMLElement {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
}

describe('attr/style op application', () => {
  it('applies and removes attributes, style ops, slots, and skips malformed ops', async () => {
    const el = host();
    const slots: Array<[string, HTMLElement | null]> = [];
    const errors: unknown[][] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
    const island = await mountIsland({
      worker: renderWorker,
      el,
      app: 'drive',
      slots: {
        plug: (n) => slots.push(['plug', n]),
        plug2: (n) => slots.push(['plug2', n]),
        inner: (n) => slots.push(['inner', n]),
      },
    });

    const input = el.querySelector('input')!;
    // Slot lifecycle: mounted as 'plug', renamed to 'plug2' (plug detached),
    // then the attr removal detached 'plug2'; the nested 'inner' slot mounts
    // with its subtree and unmounts when the subtree is removed.
    expect(slots.map(([name]) => name)).toEqual([
      'plug', 'plug', 'plug2', 'plug2', 'inner', 'inner',
    ]);
    expect(slots[0]).toEqual(['plug', input]);
    expect(slots[1]).toEqual(['plug', null]);
    expect(slots[2]).toEqual(['plug2', input]);
    expect(slots[3]).toEqual(['plug2', null]);
    expect(slots[4][0]).toBe('inner');
    expect(slots[4][1]).toBeInstanceOf(realDoc.defaultView!.HTMLElement);
    expect(slots[5]).toEqual(['inner', null]);
    // Attribute removal landed for real.
    expect(input.hasAttribute('style')).toBe(false);
    expect(input.hasAttribute('checked')).toBe(false);
    expect(input.id).toBe('i1');
    expect(input.dataset.x).toBe('1');

    // style ops: custom property, !important suffix, camelCase write, clear.
    const styled = el.querySelector('.styled') as HTMLElement;
    expect(styled.style.getPropertyValue('--brand')).toBe('#fff');
    expect(styled.style.getPropertyPriority('color')).toBe('');
    expect(styled.style.backgroundColor).toBe('blue');

    // The slot nested in a removed subtree was unmounted without its own op.
    expect(slots).toContainEqual(['inner', null]);
    expect(el.querySelector('span')).toBeNull();

    // Malformed ops hit the guards — logged, skipped, never threw.
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((a) => String(a[0]).includes('append skipped')),
    ).toBe(true);
    errSpy.mockRestore();
    island.destroy();
  });

  it('a throwing worker listener surfaces via console.error, not a crash', async () => {
    const el = host();
    const errors: unknown[][] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
    const island = await mountIsland({ worker: renderWorker, el, app: 'drive' });
    el.querySelector('button.boom')!.dispatchEvent(
      new (realDoc.defaultView as typeof window).MouseEvent('click', { bubbles: true }),
    );
    await vi.waitFor(() =>
      expect(errors.some((a) => String(a).includes('kaboom'))).toBe(true),
    );
    errSpy.mockRestore();
    island.destroy();
  });
});

describe('update-op prop diffing', () => {
  it('applies boolean/dom-property/attr/style/event/slot props, then removes them all', async () => {
    const el = host();
    const slotCalls: Array<HTMLElement | null> = [];
    const island = await mountIsland({
      worker: renderWorker,
      el,
      app: 'rprops',
      props: { phase: 1 },
      slots: { plug: (n) => slotCalls.push(n) },
    });

    const input = el.querySelector('input.ctl') as HTMLInputElement;
    expect(input.className).toBe('ctl');
    expect(input.style.color).toBe('red');
    expect(input.style.fontSize).toBe('9px');
    expect(input.title).toBe('hint');
    expect(input.dataset.extra).toBe('x');
    // Boolean props ride the DOM-property path: checked=true, disabled=true.
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(true);
    expect(slotCalls.at(-1)).toBe(input);

    // Phase 2: the style object shrinks — fontSize's removal diffs against
    // prevStyle; color changes value; checked drops to false.
    await island.updateProps({ phase: 2 });
    expect(input.style.fontSize).toBe('');
    expect(input.style.color).toBe('blue');
    expect(input.checked).toBe(false);

    // Phase 3: every prop drops — removeProp paths for className, style,
    // boolean, attr, event ref, and the slot.
    await island.updateProps({ phase: 3 });
    expect(input.className).toBe('');
    expect(input.getAttribute('style')).toBeFalsy();
    expect(input.hasAttribute('title')).toBe(false);
    expect(input.hasAttribute('data-extra')).toBe(false);
    expect(input.disabled).toBe(false);
    expect(slotCalls.at(-1)).toBeNull();

    island.destroy();
  });
});

describe('handle surface', () => {
  it('opsApplied/flushCalls getters, manual flush, and poll→push setMode switch', async () => {
    const el = host();
    const client = connectIslandWorker({ worker: renderWorker });
    const island = await mountIsland({ client, el, app: 'rcounter', mode: 'poll' });
    expect(island.mode).toBe('poll');
    expect(island.opsApplied).toBeGreaterThan(0);

    // poll → push clears the interval and subscribes the doorbell.
    island.setMode('push');
    expect(island.mode).toBe('push');
    island.setMode('poll');

    const flushesBefore = island.flushCalls;
    await island.flush();
    await vi.waitFor(() => expect(island.flushCalls).toBeGreaterThan(flushesBefore));
    island.destroy();
    client.terminate();
  });

  it('a shared client survives a failed sibling mount — the instance is handed back', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    const good = await mountIsland({ client, el: host(), app: 'rcounter' });

    // A mount task that fails worker-side (unknown app) rejects — the shared
    // client must hand the instance back, not terminate itself.
    const bad = await mountIsland({
      client,
      el: host(),
      app: 'no-such-app',
      mountTimeout: 5_000,
    }).catch((e) => e);
    expect(bad).toBeInstanceOf(Error);

    // The good island still works — the failure didn't kill the client.
    good.destroy();
    client.terminate();
  });

  it('destroy on a shared client unmounts the instance but keeps the worker', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    const elA = host();
    const elB = host();
    const a = await mountIsland({ client, el: elA, app: 'rcounter' });
    const b: IslandHandle = await mountIsland({ client, el: elB, app: 'rcounter' });
    a.destroy();
    // b's worker is still alive — its DOM is intact and dispatch round-trips.
    const btn = elB.querySelector('button.btn')!;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('count: 0');
    btn.dispatchEvent(
      new (realDoc.defaultView as typeof window).MouseEvent('click', { bubbles: true }),
    );
    await vi.waitFor(() => expect(btn.textContent).toBe('count: 1'));
    b.destroy();
    const worker = InProcessWorker.created.at(-1)!;
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });

  it('ResizeObserver ticks throttle: a fast second tick schedules the trailing push', async () => {
    let roCb: (() => void) | null = null;
    class FakeRO {
      constructor(cb: () => void) {
        roCb = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const prev = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeRO;
    try {
      const el = host();
      const island = await mountIsland({ worker: renderWorker, el, app: 'rcounter' });
      // First tick immediately after mount lands inside the 100ms window —
      // the trailing setTimeout is armed, not a direct pushSize.
      roCb!();
      await new Promise((r) => setTimeout(r, 150));
      // Past the window now — a tick pushes directly.
      roCb!();
      island.destroy();
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = prev;
    }
  });
});
