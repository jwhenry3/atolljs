// @vitest-environment happy-dom
/**
 * React-shell E2E — <Shell/> mounts all seven islands through <Island/>
 * components instead of imperative mountIsland() calls. Proves:
 *   - the shell mounts via the component API against the REAL worker entry,
 *   - the charts island resolves its name from the stamped component ref,
 *   - mediation works declaratively: a controls emit becomes a state change
 *     that flows back in as props (filter → table rows), and
 *   - badges/status/stats land in ordinary React-rendered DOM.
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
// The shell mounts the registry worker AND the two instance workers — all
// entries register into the shared in-process module graph.
InProcessWorker.handlerModules = [
  () => import('../src/worker/render.worker'),
  () => import('../src/worker/vanilla.worker'),
  () => import('../src/worker/map.worker'),
];

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

  /** Spy 2d context — happy-dom's getContext returns null, which would leave
      the Sparkline's rAF tick body dead. A stub lets the loop run for real. */
  const ctx2d = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
  };

  beforeAll(async () => {
    realDoc = document;
    vi.spyOn(
      realDoc.createElement('canvas').constructor.prototype as object,
      'getContext',
    ).mockReturnValue(ctx2d);
    const { createRoot } = await import('react-dom/client');
    const { Shell } = await import('../src/shell');
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    createRoot(host).render(<Shell />);
  });

  it('mounts every island through <Island/> components', async () => {
    await waitFor(() => realDoc.querySelectorAll('.island-root').length === 7);
    await waitFor(() => realDoc.querySelectorAll('.island-head .badge').length === 7);
    await waitFor(() =>
      [...realDoc.querySelectorAll('.island-head .badge')].every((b) =>
        /^worker w-/.test(b.textContent ?? ''),
      ),
    );
    // Real DOM landed via op replay inside the component-rendered divs.
    await waitFor(() => realDoc.querySelector('#island-table tbody tr'), 60_000);
    await waitFor(() => realDoc.querySelector('.vanilla-log'), 60_000);
    await waitFor(() => realDoc.querySelector('.recharts-surface'), 60_000);
  }, 120_000);

  it('mediates controls → table declaratively via props', async () => {
    const status = realDoc.getElementById('status-line')!;
    const rowsBefore = realDoc.querySelectorAll('#island-table tbody tr').length;
    expect(rowsBefore).toBeGreaterThan(0);

    // Type into the controls island's filter input — the emit becomes shell
    // state, which flows back as the table island's props.
    const input = realDoc.querySelector('.island-root input') as HTMLInputElement;
    input.value = 'eu-central';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await waitFor(() => /filterChanged/.test(status.textContent ?? ''));
    await waitFor(() => {
      const cells = realDoc.querySelectorAll('#island-table tbody tr td:first-child');
      return cells.length > 0 && cells.length < rowsBefore;
    });
  }, 45_000);

  it('transport stats aggregate in React-rendered DOM', async () => {
    const stats = realDoc.getElementById('transport-stats')!;
    await waitFor(() => /ops applied: [1-9]/.test(stats.textContent ?? ''));
    expect(stats.textContent).toContain('sync: push');
  });

  /* Every island's onEvent prop lands as a status-line update — clicking
     real DOM inside each island exercises the inline handlers in shell.tsx. */
  const status = () => realDoc.getElementById('status-line')!.textContent ?? '';
  const click = (el: Element) =>
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const findButton = (re: RegExp) =>
    [...realDoc.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));

  it('controls sort/count emits reach the shell status line', async () => {
    const statusEl = realDoc.getElementById('status-line')!;

    click(findButton(/sort:/)!);
    await waitFor(() => /sortChanged → table props\.desc=true/.test(statusEl.textContent ?? ''));

    click(findButton(/^count:/)!);
    await waitFor(() => /controls island counter → 1/.test(statusEl.textContent ?? ''));
  }, 30_000);

  it('both data-table instances emit rowSelected to their own handlers', async () => {
    click(realDoc.querySelector('#island-table tbody tr')!);
    await waitFor(() => /table island emitted rowSelected → shell \(row #\d+\)/.test(status()));

    click(realDoc.querySelector('#island-table-2 tbody tr')!);
    await waitFor(() =>
      /second data-table instance emitted rowSelected \(row #\d+\)/.test(status()),
    );
  }, 30_000);

  it('vanilla island colorPicked emit reaches the shell', async () => {
    await waitFor(() => realDoc.querySelector('.swatch'));
    const swatch = realDoc.querySelector('.swatch')!;
    click(swatch);
    await waitFor(() => /vanilla island emitted colorPicked → #2d6cdf/.test(status()));
  }, 30_000);

  it('charts island chartClicked emit reaches the shell', async () => {
    await waitFor(() =>
      realDoc.querySelector('.recharts-bar-rectangle path, .recharts-rectangle'),
    );
    click(realDoc.querySelector('.recharts-bar-rectangle path, .recharts-rectangle')!);
    await waitFor(() =>
      /charts island emitted chartClicked → us-east \(418 incidents\)/.test(status()),
    );
  }, 30_000);

  it('map island emits markerClicked / placeSelected / zoomChanged', async () => {
    const mapEl = realDoc.getElementById('island-map')!;
    await waitFor(() => mapEl.querySelector('.atoll-map-pin'), 60_000);

    click(mapEl.querySelector('.atoll-map-pin')!);
    await waitFor(() => /map island emitted markerClicked → Paris/.test(status()));

    click(mapEl.querySelector('.atoll-map-place-btn')!);
    await waitFor(() => /map island emitted placeSelected → Lisbon/.test(status()));

    const pane = mapEl.querySelector('.leaflet-map-pane')!;
    for (const type of ['wheel', 'mousewheel']) {
      pane.dispatchEvent(new WheelEvent(type, { bubbles: true, deltaY: -240 }));
    }
    await waitFor(() => /map island emitted zoomChanged → zoom \d+/.test(status()), 15_000);
  }, 90_000);

  it('sparkline transclusion slot runs its canvas tick loop', async () => {
    // The worker stats island renders a data-atoll-slot div; the shell portals
    // a real <canvas> into it and drives a rAF trace on the 2d context.
    await waitFor(() => realDoc.querySelector('canvas'));
    const canvas = realDoc.querySelector('canvas')!;
    await waitFor(() => ctx2d.stroke.mock.calls.length > 0);

    // happy-dom reports 0 box sizes — give the canvas parent a width so the
    // trace grows past a single point and lineTo runs too.
    Object.defineProperty(canvas.parentElement, 'clientWidth', {
      value: 200,
      configurable: true,
    });
    Object.defineProperty(canvas.parentElement, 'clientHeight', {
      value: 56,
      configurable: true,
    });
    await waitFor(() => ctx2d.lineTo.mock.calls.length > 0);
  }, 30_000);

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
