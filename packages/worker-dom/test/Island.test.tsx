// @vitest-environment happy-dom
/**
 * `<Island/>` — mounts an island worker declaratively from a React shell.
 * In-process E2E like islands.test.ts: real registry + op protocol, the only
 * fake being the thread boundary.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { InProcessWorker } from '../../../test/inProcessWorker';
import { islandApp, islandAppNameOf } from '../src/index';
import type { IslandHandle } from '../src/index';
import { echoApp } from './fixtures/echo.worker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/echo.worker')];

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let Island: typeof import('../src/react').Island;
let islandComponent: typeof import('../src/react').islandComponent;
let lazyIsland: typeof import('../src/react').lazyIsland;
// In-process artifact: once a worker island calls installDomShim, ambient
// `document` resolves to its PROXY document (shared globalThis) — capture the
// real one before any mounts. Real browsers never share globals across threads.
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ Island, islandComponent, lazyIsland } = await import('../src/react'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });

/** A typed component handle — proves `props` infers from the reference's own
 *  signature; the registry's 'echo' app is what actually renders. */
const TypedEcho = islandApp('echo', (_props: { text: string }) => null);

describe('<Island/>', () => {
  it('mounts by app reference, relays events, re-props, unmounts cleanly', async () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const emitted: Array<{ name: string; payload: unknown }> = [];
    let handle: IslandHandle | undefined;

    const tree = (
      <Island
        worker={renderWorker}
        app={echoApp}
        props={{ text: 'hello island' }}
        onEvent={(name, payload) => emitted.push({ name, payload })}
        onReady={(h) => (handle = h)}
        className="shell-box"
        data-role="island"
      />
    );
    const root = createRoot(host);
    await act(async () => {
      root.render(tree);
    });

    // Async mount → real DOM from the worker's op stream.
    await vi.waitFor(() => expect(host.querySelector('.echo')?.textContent).toBe('hello island'));
    expect(handle?.pid).toMatch(/^w-/);
    expect((host.firstElementChild as HTMLElement).className).toBe('shell-box');
    expect((host.firstElementChild as HTMLElement).dataset.role).toBe('island');

    // props change → updateProps → imperative rebuild with the new text.
    await act(async () => {
      root.render(
        <Island
          worker={renderWorker}
          app={echoApp}
          props={{ text: 'updated' }}
          onEvent={(name, payload) => emitted.push({ name, payload })}
        />,
      );
    });
    await vi.waitFor(() => expect(host.querySelector('.echo')?.textContent).toBe('updated'));

    // Click → dispatch round-trip → emit → onEvent.
    act(() => {
      host.querySelector('.ping')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'pinged')).toBe(true));

    // Re-render with equal props must NOT hit updateProps again.
    const flushCalls = handle!.flushCalls;
    const opsApplied = handle!.opsApplied;
    await act(async () => {
      root.render(
        <Island
          worker={renderWorker}
          app={echoApp}
          props={{ text: 'updated' }}
          onEvent={(name, payload) => emitted.push({ name, payload })}
        />,
      );
    });
    // No new ops from a props-identical render (updateProps would have
    // rebuilt the imperative tree — opsApplied would climb).
    expect(handle!.opsApplied).toBe(opsApplied);
    expect(handle!.flushCalls).toBe(flushCalls);

    // Unmount → island destroyed (its worker terminated).
    const worker = InProcessWorker.created.at(-1)!;
    await act(async () => {
      root.unmount();
    });
    expect(worker.terminated).toBe(true);
  });

  it('resolves stamped names from component references — with prop inference', () => {
    // The compile-time contract this whole feature exists for: props type
    // comes from the component signature, not Record<string, unknown>.
    const good = <Island app={TypedEcho} props={{ text: 'x' }} worker={renderWorker} />;
    expect(good.props.app).toBe(TypedEcho);
    // @ts-expect-error — `missing` is not a prop of TypedEcho's signature
    const _bad = <Island app={TypedEcho} props={{ missing: 1 }} worker={renderWorker} />;
    void _bad;
    expect(islandAppNameOf(TypedEcho)).toBe('echo');
  });
});

describe('worker-loaded component proxies', () => {
  it('islandComponent takes the worker app\'s props inline', async () => {
    const Echo = islandComponent<{ text: string }>('echo');
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const emitted: Array<{ name: string; payload: unknown }> = [];

    const root = createRoot(host);
    await act(async () => {
      root.render(
        <Echo
          worker={renderWorker}
          text="contract props"
          onEvent={(name, payload) => emitted.push({ name, payload })}
          containerProps={{ className: 'proxy-box', id: 'echo-proxy' }}
        />,
      );
    });

    // Non-shell props flowed through as the island's props — inline, not
    // nested under `props` — and containerProps styled the div.
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('contract props'),
    );
    const container = host.querySelector('#echo-proxy') as HTMLElement;
    expect(container.className).toBe('proxy-box');

    act(() => {
      host.querySelector('.ping')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'pinged')).toBe(true));

    // @ts-expect-error — `missing` is not part of the proxy's contract
    const _bad = <Echo worker={renderWorker} missing={1} />;
    void _bad;

    await act(async () => {
      root.unmount();
    });
  });

  it('lazyIsland suspends on the loader, then mounts by stamped reference', async () => {
    const LazyEcho = lazyIsland(() => Promise.resolve({ default: TypedEcho }));
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);

    const root = createRoot(host);
    await act(async () => {
      root.render(
        <Suspense fallback={<div className="lazy-fallback">loading…</div>}>
          <LazyEcho worker={renderWorker} text="lazy mounted" />
        </Suspense>,
      );
    });

    // The lazy phase resolves through Suspense (React.lazy semantics), then
    // the island mounts into the committed container.
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('lazy mounted'),
    );
    expect(host.querySelector('.lazy-fallback')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
