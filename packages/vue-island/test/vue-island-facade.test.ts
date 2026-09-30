// @vitest-environment happy-dom
/**
 * The Vue facade — `islandComponent`/`lazyIsland`, mirroring the React
 * binding's proxy components: attributes that aren't shell concerns become
 * the worker app's props; lazy resolves `{ default: A }` and the contract
 * module shape `{ app: A, worker? }`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, h, reactive } from 'vue';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/echo.worker')];

let islandComponent: typeof import('../src/index').islandComponent;
let lazyIsland: typeof import('../src/index').lazyIsland;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ islandComponent, lazyIsland } = await import('../src/index'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });

const mountHost = (): HTMLElement => {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
};

describe('islandComponent', () => {
  it('routes non-shell attributes through as the island props', async () => {
    const EchoIsland = islandComponent<{ text: string }>('echo');
    const host = mountHost();
    createApp(EchoIsland, { worker: renderWorker, text: 'via facade' }).mount(host);
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('via facade'),
    );
  });

  it('pushes attribute changes through updateProps', async () => {
    const EchoIsland = islandComponent<{ text: string }>('echo');
    const host = mountHost();
    const attrs = reactive({ worker: renderWorker, text: 'before' });
    createApp({ render: () => h(EchoIsland, attrs) }).mount(host);
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('before'),
    );
    attrs.text = 'after';
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('after'),
    );
  });

  it('reads shell attributes at call time (onEvent receives emits)', async () => {
    const EchoIsland = islandComponent<{ text: string }>('echo');
    const host = mountHost();
    const events: unknown[] = [];
    createApp(EchoIsland, {
      worker: renderWorker,
      text: 'events',
      onEvent: (name: string, payload: unknown) => events.push([name, payload]),
      containerProps: { class: 'outer', 'data-tag': 'facade' },
    }).mount(host);
    await vi.waitFor(() => expect(events).toContainEqual(['ready', { text: 'events' }]));
    const container = host.firstElementChild as HTMLElement;
    expect(container.classList.contains('outer')).toBe(true);
    expect(container.getAttribute('data-tag')).toBe('facade');
  });
});

describe('lazyIsland', () => {
  it('resolves a `{ default: app }` module, then mounts', async () => {
    const { echoApp } = await import('./fixtures/echo.worker');
    const EchoIsland = lazyIsland(() => Promise.resolve({ default: echoApp }));
    const host = mountHost();
    createApp(EchoIsland, { worker: renderWorker, text: 'lazy' }).mount(host);
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('lazy'),
    );
  });

  it('contract modules `{ app, worker }` carry their own worker factory', async () => {
    const { echoApp } = await import('./fixtures/echo.worker');
    const EchoIsland = lazyIsland(() =>
      Promise.resolve({ app: echoApp, worker: renderWorker }),
    );
    const host = mountHost();
    // No `worker` attribute — the contract supplies it.
    createApp(EchoIsland, { text: 'contract' }).mount(host);
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('contract'),
    );
  });
});
