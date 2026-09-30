// @vitest-environment happy-dom
/**
 * `useIsland` + `<AtollIsland/>` — mount an island worker declaratively from
 * a Vue shell. In-process E2E like the react-island suite: real registry +
 * op protocol, the only fake being the thread boundary.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, h, reactive } from 'vue';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { connectIslandWorker } from '@atolljs/islands';
import type { IslandHandle } from '../src/index';

vi.stubGlobal('Worker', InProcessWorker);
// Importing the fixture module performs defineMonoWorker's registration
// side effects — exactly what a bundled worker entry does at boot.
InProcessWorker.handlerModules = [() => import('./fixtures/echo.worker')];

let AtollIsland: typeof import('../src/index').AtollIsland;
let useIsland: typeof import('../src/index').useIsland;
// In-process artifact: once a worker instance mounts, ambient `document` can
// resolve to its PROXY document (shared globalThis) — capture the real one
// before any mounts. Real browsers never share globals across threads.
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ AtollIsland, useIsland } = await import('../src/index'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });

describe('<AtollIsland/>', () => {
  it('mounts, relays events, re-props, and destroys cleanly', async () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const emitted: Array<{ name: string; payload: unknown }> = [];
    let handle: IslandHandle | undefined;
    // A reactive props object — mutating it drives handle.updateProps.
    const islandProps = reactive({ text: 'hello island' });
    const client = connectIslandWorker({ worker: renderWorker });

    const app = createApp({
      render: () =>
        h(AtollIsland, {
          client,
          app: 'echo',
          props: islandProps,
          onEvent: (name: string, payload: unknown) => emitted.push({ name, payload }),
          onReady: (h: IslandHandle) => {
            handle = h;
          },
        }),
    });
    app.mount(host);

    // Async mount → real DOM replayed from the worker's op stream, and the
    // app's mount-time emit('ready') lands on onEvent.
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('hello island'),
    );
    expect((host.querySelector('.atoll-island') as HTMLElement).className).toBe('atoll-island');
    expect(handle?.pid).toMatch(/^w-/);
    expect(emitted.some((e) => e.name === 'ready')).toBe(true);

    // Reactive props change → updateProps → imperative rebuild.
    islandProps.text = 'updated';
    await vi.waitFor(() => expect(host.querySelector('.echo')?.textContent).toBe('updated'));

    // Unmount → island destroyed (its worker terminated).
    const worker = InProcessWorker.created.at(-1)!;
    app.unmount();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });
});

describe('useIsland', () => {
  it('mounts when host lands, tracks reactive props, destroys on scope stop', async () => {
    const emitted: Array<{ name: string; payload: unknown }> = [];
    const islandProps = reactive({ text: 'composable' });
    const client = connectIslandWorker({ worker: renderWorker });

    const scope = effectScope();
    const island = scope.run(() =>
      useIsland({
        client,
        app: 'echo',
        props: islandProps,
        onEvent: (name, payload) => emitted.push({ name, payload }),
      }),
    )!;
    // No host bound yet — 'idle', not 'mounting'.
    expect(island.status.value).toBe('idle');

    // The composable doesn't render — the caller binds host to an element.
    // `<div ref="host">` would assign exactly this on mount.
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    island.host.value = el;

    await vi.waitFor(() => expect(island.status.value).toBe('ready'));
    expect(island.handle.value?.pid).toMatch(/^w-/);
    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe('composable'),
    );
    expect(emitted.some((e) => e.name === 'ready')).toBe(true);

    islandProps.text = 'again';
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('again'));

    const worker = InProcessWorker.created.at(-1)!;
    scope.stop();
    expect(island.handle.value).toBeNull();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });
});
