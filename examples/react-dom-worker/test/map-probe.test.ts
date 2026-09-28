// @vitest-environment happy-dom
/* Scratch probe — does real Leaflet mount + interact on the proxy DOM? */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '../../../test/inProcessWorker';

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

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('../src/worker/render.worker')];

let connectIslandWorker: typeof import('@jwhenry123/mesh-worker-dom').connectIslandWorker;
let mountIsland: typeof import('@jwhenry123/mesh-worker-dom').mountIsland;
beforeAll(async () => {
  ({ connectIslandWorker, mountIsland } = await import('@jwhenry123/mesh-worker-dom'));
});

const islandClient = () =>
  connectIslandWorker({
    worker: () =>
      new Worker(new URL('../src/worker/render.worker.ts', import.meta.url), { type: 'module' }),
  });

const fire = (el: Element, event: Event): void => {
  el.dispatchEvent(event);
};

describe('leaflet probe', () => {
  it('raw client: what ops does the map stream produce', async () => {
    const prevDoc = (globalThis as any).document;
    const prevWin = (globalThis as any).window;
    const prevElement = (globalThis as any).Element;
    try {
      const client = islandClient();
      const mountOps = await client.mount('map', {});
      console.log('mount ops:', mountOps.map((o) => o.t).join(','));
      await client.setSize('map', 640, 420);
      await new Promise((r) => setTimeout(r, 300));
      const flushOps = await client.flush('map');
      console.log(
        'flush ops:',
        flushOps.reduce<Record<string, number>>((acc, o) => {
          acc[o.t] = (acc[o.t] ?? 0) + 1;
          return acc;
        }, {}),
      );
      console.log('first 40:', flushOps.slice(0, 40));
      console.log(
        'p0 appends:',
        flushOps.filter((o) => o.t === 'append' && o.parent === 0).map((o) => o.child),
      );
      console.log(
        'creates:',
        flushOps.filter((o) => o.t === 'create').map((o) => `${o.id}:${o.type}`),
      );
      client.terminate();
    } finally {
      (globalThis as any).document = prevDoc;
      (globalThis as any).window = prevWin;
      (globalThis as any).Element = prevElement;
    }
  });

  it('mounts + interacts with a real Leaflet map in an island', async () => {
    const prevDoc = (globalThis as any).document;
    const prevWin = (globalThis as any).window;
    const prevElement = (globalThis as any).Element;
    try {
      const el = document.createElement('div');
      Object.defineProperty(el, 'clientWidth', { value: 640, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 420, configurable: true });
      document.body.appendChild(el);

      const emitted: Array<{ name: string; payload: unknown }> = [];
      const island = await mountIsland({
        client: islandClient(),
        el,
        app: 'map',
        onEvent: (name, payload) => emitted.push({ name, payload }),
      });
      island.setMode('push');

      await vi.waitFor(
        async () => {
          await island.flush();
          // doc.body IS the leaflet container — the class lands on el itself.
          expect(el.classList.contains('leaflet-container')).toBe(true);
        },
        { timeout: 10000 },
      );
      await island.flush();
      console.log('html len', el.innerHTML.length);
      console.log('childNodes', el.childNodes.length, 'children', el.children.length);
      console.log('outer:', el.outerHTML.slice(0, 300));
      console.log('tiles:', el.querySelectorAll('img.leaflet-tile').length);
      console.log('pins:', el.querySelectorAll('.mesh-map-pin').length);
      console.log('zoom ctrls:', el.querySelectorAll('.leaflet-control-zoom a').length);
      console.log('places:', el.querySelectorAll('.mesh-map-place-btn').length);
      console.log('attr:', el.querySelector('.leaflet-control-attribution')?.textContent);

      // ── drag-pan: Leaflet listens mousedown on the map pane; move/up on
      //    document (id-0 container). Dispatch a real drag sequence.
      const pane = el.querySelector('.leaflet-map-pane')! as HTMLElement;
      const paneBefore = pane.style.left;
      fire(pane, new MouseEvent('mousedown', { bubbles: true, clientX: 320, clientY: 210, button: 0 }));
      // document-level listeners → attached to el (id 0) — dispatch on a child so it bubbles.
      fire(pane, new MouseEvent('mousemove', { bubbles: true, clientX: 240, clientY: 160 }));
      await vi.waitFor(async () => {
        await island.flush();
        // Mid-drag Leaflet repositions the pane (setPosition → left/top).
        expect(pane.style.left !== paneBefore || pane.style.top !== '' || pane.style.transform !== '').toBe(true);
      });
      console.log('mid-drag pane:', pane.style.left, pane.style.top, pane.style.transform);
      fire(pane, new MouseEvent('mouseup', { bubbles: true, clientX: 240, clientY: 160 }));
      await island.flush();
      console.log('pan ok — pane settled at', pane.style.left, pane.style.top, pane.style.transform);

      // ── wheel zoom — deltaY payload feeds ScrollWheelZoom. Leaflet picks
      // 'wheel' or legacy 'mousewheel' per feature-detect; fire both so
      // whichever hook it registered gets a deltaY.
      for (const type of ['wheel', 'mousewheel']) {
        fire(pane, new WheelEvent(type, { bubbles: true, deltaY: -240 }));
      }
      await vi.waitFor(async () => {
        await island.flush();
        expect(emitted.some((e) => e.name === 'zoomChanged')).toBe(true);
      }, { timeout: 8000 });
      console.log('zoom ok —', JSON.stringify(emitted.filter(e=>e.name==='zoomChanged')));

      // ── marker click → emit reaches the shell.
      const pin = el.querySelector('.mesh-map-pin')!;
      fire(pin, new MouseEvent('click', { bubbles: true }));
      await vi.waitFor(async () => {
        await island.flush();
        expect(emitted.some((e) => e.name === 'markerClicked')).toBe(true);
      });
      console.log('marker ok —', JSON.stringify(emitted.filter(e=>e.name==='markerClicked')));

      // ── place button → setView + emit.
      const place = el.querySelector('.mesh-map-place-btn')!;
      fire(place, new MouseEvent('click', { bubbles: true }));
      await vi.waitFor(async () => {
        await island.flush();
        expect(emitted.some((e) => e.name === 'placeSelected')).toBe(true);
      });
      console.log('places ok');

      island.destroy();
    } finally {
      (globalThis as any).document = prevDoc;
      (globalThis as any).window = prevWin;
      (globalThis as any).Element = prevElement;
    }
  });
});
