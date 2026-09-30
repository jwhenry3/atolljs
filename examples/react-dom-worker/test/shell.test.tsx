// @vitest-environment happy-dom
/**
 * React-shell E2E — <Shell/> mounts the framework-native islands through
 * @atolljs/react-island components instead of imperative mountIsland()
 * calls. Proves:
 *   - the shell mounts via <Island/>, islandComponent, and lazyIsland
 *     (contract module) against the REAL worker entry,
 *   - both counters share ONE client — two 'counter@N' mounts in one
 *     worker,
 *   - worker emits (incremented / noteAdded / rendered) land as React
 *     state on the status line, and
 *   - the 1M-incidents island virtualizes: ~22 DOM rows, a scroll event
 *     round-trips and re-renders the window worker-side.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';

const requireFromRoot = async () => {
  const { createRequire } = await import('node:module');
  const { join } = await import('node:path');
  return createRequire(join(process.cwd(), 'package.json'));
};
vi.mock('react', async () => {
  const mod = (await requireFromRoot())('react') as Record<string, unknown>;
  return { ...mod, default: mod };
});
vi.mock('react/jsx-runtime', async () => {
  const mod = (await requireFromRoot())('react/jsx-runtime') as Record<string, unknown>;
  return { ...mod, default: mod };
});
vi.mock('react-dom/client', async () => {
  const mod = (await requireFromRoot())('react-dom/client') as Record<string, unknown>;
  return { ...mod, default: mod };
});

vi.stubGlobal('Worker', InProcessWorker);
// In-process workers share one module graph — the registry worker entry
// registers its counter/notes/incidents apps into it.
InProcessWorker.handlerModules = [() => import('../src/worker/react.worker')];

const waitFor = async (fn: () => unknown, timeoutMs = 15_000): Promise<void> => {
  const start = Date.now();
  for (;;) {
    try {
      const r = fn();
      if (r) return;
    } catch {
      /* keep polling */
    }
    if (Date.now() - start > timeoutMs) {
      fn();
      throw new Error('waitFor timed out');
    }
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('React shell', () => {
  // In-process only: once a worker island calls installDomShim, the ambient
  // `document` getter can resolve to a worker instance's PROXY document — the
  // instance dispatcher and this test share globalThis. Capture the real one
  // before rendering; real browsers never share globals across threads.
  let realDoc: Document;

  beforeAll(async () => {
    realDoc = document;
    const { createRoot } = await import('react-dom/client');
    const { Shell } = await import('../src/shell');
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    createRoot(host).render(<Shell />);
  });

  it('mounts all four islands through the component APIs', async () => {
    await waitFor(() => realDoc.querySelectorAll('.island-root').length === 4);
    await waitFor(() => realDoc.querySelectorAll('.island-head .badge').length === 4);
    await waitFor(() =>
      [...realDoc.querySelectorAll('.island-head .badge')].every((b) =>
        /^worker w-/.test(b.textContent ?? ''),
      ),
    );
    // Real DOM landed via op replay inside the component-rendered divs.
    await waitFor(() => realDoc.querySelector('.react-counter'), 60_000);
    await waitFor(() => realDoc.querySelector('.react-notes'), 60_000);
    await waitFor(() => realDoc.querySelector('.inc-row'), 60_000);
  }, 120_000);

  const status = () => realDoc.getElementById('status-line')!.textContent ?? '';
  const click = (el: Element) =>
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const findButton = (re: RegExp) =>
    [...realDoc.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));

  it('counter islands emit incremented to the shell status line', async () => {
    const heads = [...realDoc.querySelectorAll('.island-head')];
    const counterHead = heads.find((h) => /counter \(react-reconciler/.test(h.textContent ?? ''))!;
    click(counterHead.parentElement!.querySelector('.mw-btn')!);
    await waitFor(() => /alpha counter → 1/.test(status()));
  }, 30_000);

  it('the notes island round-trips input + emits noteAdded', async () => {
    const notesRoot = [...realDoc.querySelectorAll('.react-notes')][0]!;
    const input = notesRoot.querySelector('input') as HTMLInputElement;
    input.value = 'ship it';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    click(notesRoot.querySelector('.atoll-map-place-btn')!);
    await waitFor(() => /notes island emitted noteAdded → "ship it" \(1 total\)/.test(status()));
    await vi.waitFor(() =>
      expect(notesRoot.textContent).toContain('1 note(s) — state lives in the worker'),
    );
  }, 30_000);

  it('the incidents island virtualizes 1M rows and scrolls worker-side', async () => {
    const viewport = realDoc.querySelector('.inc-viewport') as HTMLElement;
    expect(viewport).not.toBeNull();
    // ~22 rows rendered — never a million.
    await waitFor(() => realDoc.querySelectorAll('.inc-row').length === 22);

    // A scroll is a dispatch round-trip: scrollTop rides the event payload,
    // the worker re-renders the window and emits 'rendered' with timings.
    Object.defineProperty(viewport, 'scrollTop', { value: 24 * 500_000, configurable: true });
    viewport.dispatchEvent(new Event('scroll'));
    await waitFor(() => /incidents island rendered rows 499,9\d\d–500,0\d\d/.test(status()), 30_000);
    await waitFor(() =>
      /rows 499,9\d\d–500,0\d\d/.test(
        realDoc.querySelector('.inc-stats')!.textContent ?? '',
      ),
    );
  }, 60_000);

  it('transport stats aggregate in React-rendered DOM', async () => {
    const stats = realDoc.getElementById('transport-stats')!;
    await waitFor(() => /ops applied: [1-9]/.test(stats.textContent ?? ''));
    expect(stats.textContent).toContain('sync: push');
  });

  it('transport buttons switch mode across all mounted island handles', async () => {
    const stats = realDoc.getElementById('transport-stats')!;
    (realDoc.getElementById('poll-btn') as HTMLButtonElement).click();
    await waitFor(() => /sync: poll/.test(stats.textContent ?? ''));
    (realDoc.getElementById('push-btn') as HTMLButtonElement).click();
    await waitFor(() => /sync: push/.test(stats.textContent ?? ''));
  }, 30_000);

  afterAll(() => {
    InProcessWorker.handlerModules = [];
  });
});
