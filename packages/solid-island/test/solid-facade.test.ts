// @vitest-environment happy-dom
/**
 * `islandComponent`/`lazyIsland` — the component-proxy facade mirroring the
 * React binding: a worker app types like a local component, taking its props
 * inline while shell concerns (worker/client/slots/fallback…) split off.
 * In-process E2E — real registry + op protocol; only the thread boundary is
 * faked (InProcessWorker).
 *
 * The proxies return `[container, fallbackAccessor]`, and `lazy()` adds its
 * own accessor wrapping — a real JSX shell inserts both reactively; these
 * tests wire a small reconcile helper instead of pulling in solid-js/web.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { connectIslandWorker } from '@atolljs/islands';
import type { IslandShellProps } from '../src/index';
import { echoApp } from './fixtures/echo.worker';

vi.stubGlobal('Worker', InProcessWorker);
// In-process workers share one module graph — importing the worker entry
// performs its defineMonoWorker/APP_REGISTRY side effects at INIT_MEMORY.
InProcessWorker.handlerModules = [() => import('./fixtures/echo.worker')];

let islandComponent: typeof import('../src/index').islandComponent;
let lazyIsland: typeof import('../src/index').lazyIsland;
// In-process artifact: once a worker island installs the instance dispatcher,
// ambient `document` can resolve to a instance's PROXY document — capture the
// real one before any mounts. Real browsers never share globals across threads.
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ islandComponent, lazyIsland } = await import('../src/index'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });

/**
 * Minimal stand-in for JSX insertion: evaluate accessors recursively and
 * reconcile `host`'s children by node identity — enough for proxies that
 * return `[el, fallbackAccessor]` or lazy components returning an accessor.
 */
const mountProxy = (
  Component: (props: Record<string, unknown>) => unknown,
  props: Record<string, unknown>,
  host: HTMLElement,
): { dispose: () => void } => ({
  dispose: createRoot((dispose) => {
    // Inside the root — the component wires effects/cleanup to this owner.
    const out = Component(props);
    let placed: Node[] = [];
    createEffect(() => {
      const resolve = (v: unknown): Node[] => {
        while (typeof v === 'function') v = (v as () => unknown)();
        if (Array.isArray(v)) return v.flatMap(resolve);
        if (v === null || v === undefined || v === false || v === true) return [];
        return [typeof v === 'string' ? realDoc.createTextNode(v) : (v as Node)];
      };
      const next = resolve(out);
      for (const n of placed) if (!next.includes(n)) (n as ChildNode).remove();
      next.forEach((n, i) => {
        if (host.childNodes[i] !== n) host.insertBefore(n, host.childNodes[i] ?? null);
      });
      placed = next;
    });
    return dispose;
  }),
});

describe('worker-loaded component proxies', () => {
  it("islandComponent takes the worker app's props inline", async () => {
    const Echo = islandComponent<{ text: string }>('echo');
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const emitted: Array<{ name: string; payload: unknown }> = [];

    const { dispose } = mountProxy(
      Echo as unknown as (p: Record<string, unknown>) => unknown,
      {
        worker: renderWorker,
        text: 'contract props',
        onEvent: (name: string, payload: unknown) => emitted.push({ name, payload }),
        containerProps: { class: 'proxy-box', id: 'echo-proxy' },
        document: realDoc,
      } satisfies IslandShellProps & Record<string, unknown>,
      host,
    );

    // Non-shell props flowed through as the island's props — inline, not
    // nested under `props` — and containerProps styled the container div.
    const el = host.firstElementChild as HTMLElement;
    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe('contract props'),
    );
    expect(el.className).toBe('proxy-box');
    expect(el.id).toBe('echo-proxy');

    el.querySelector('.ping')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'pinged')).toBe(true));

    dispose();
  });

  it('islandComponent proxies reactive props → updateProps', async () => {
    const Echo = islandComponent<{ text: string }>('echo');
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const [text, setText] = createSignal('one');

    // JSX-compiled props are getters — simulate by hand.
    const { dispose } = mountProxy(
      Echo as unknown as (p: Record<string, unknown>) => unknown,
      {
        worker: renderWorker,
        get text() {
          return text();
        },
        document: realDoc,
      },
      host,
    );

    const el = host.firstElementChild as HTMLElement;
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('one'));
    setText('two');
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('two'));
    dispose();
  });

  it('islandComponent() mounts a instance worker namelessly', async () => {
    // 1:1 topology — no registry key: the worker's single registered app is
    // the whole contract.
    const Solo = islandComponent<{ text?: string }>();
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);

    const { dispose } = mountProxy(
      Solo as (p: Record<string, unknown>) => unknown,
      { worker: renderWorker, text: 'nameless mount', document: realDoc },
      host,
    );

    const el = host.firstElementChild as HTMLElement;
    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe('nameless mount'),
    );
    dispose();
  });

  it('a shared client mounts two proxies into one worker — teardown is ref-counted', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    const before = InProcessWorker.created.length;

    const Echo = islandComponent<{ text: string }>('echo');
    const hostA = realDoc.createElement('div');
    const hostB = realDoc.createElement('div');
    realDoc.body.append(hostA, hostB);

    const a = mountProxy(
      Echo as unknown as (p: Record<string, unknown>) => unknown,
      { client, text: 'instance A', document: realDoc },
      hostA,
    );
    const b = mountProxy(
      Echo as unknown as (p: Record<string, unknown>) => unknown,
      { client, text: 'instance B', document: realDoc },
      hostB,
    );

    // ONE worker spawned for both islands — two mounts in the same thread.
    await vi.waitFor(() => {
      expect(hostA.querySelector('.echo')?.textContent).toBe('instance A');
      expect(hostB.querySelector('.echo')?.textContent).toBe('instance B');
    });
    const workers = InProcessWorker.created.slice(before);
    expect(workers).toHaveLength(1);

    // First dispose: the shared worker lives for the remaining island.
    a.dispose();
    expect(workers[0].terminated).toBe(false);

    b.dispose();
    await vi.waitFor(() => expect(workers[0].terminated).toBe(true));
  });

  it('lazyIsland suspends on the loader, then mounts by stamped reference', async () => {
    const LazyEcho = lazyIsland(() => Promise.resolve({ default: echoApp }));
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);

    const { dispose } = mountProxy(
      LazyEcho as unknown as (p: Record<string, unknown>) => unknown,
      { worker: renderWorker, text: 'lazy mounted', document: realDoc },
      host,
    );

    // The lazy component renders nothing until the loader resolves.
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('lazy mounted'),
    );
    dispose();
  });

  it('lazyIsland resolves a { app, worker } contract module — the island carries its own worker', async () => {
    const LazyEcho = lazyIsland(() => Promise.resolve({ app: echoApp, worker: renderWorker }));
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);

    const { dispose } = mountProxy(
      LazyEcho as unknown as (p: Record<string, unknown>) => unknown,
      { text: 'contract worker', document: realDoc },
      host,
    );

    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('contract worker'),
    );
    dispose();
  });

  it('proxy renders `fallback` until the island is ready', async () => {
    const Echo = islandComponent<{ text: string }>('echo');
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const fb = realDoc.createElement('span');
    fb.className = 'fb';
    fb.textContent = 'loading…';

    const { dispose } = mountProxy(
      Echo as unknown as (p: Record<string, unknown>) => unknown,
      { worker: renderWorker, text: 'faded in', fallback: fb, document: realDoc },
      host,
    );

    const el = host.firstElementChild as HTMLElement;
    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe('faded in'),
    );
    // Ready → the fallback node was pulled out of the DOM.
    await vi.waitFor(() => expect(host.querySelector('.fb')).toBeNull());
    dispose();
  });
});
