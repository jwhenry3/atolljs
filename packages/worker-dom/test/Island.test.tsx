// @vitest-environment happy-dom
/**
 * `<Island/>` — mounts an island worker declaratively from a React shell.
 * In-process E2E like islands.test.ts: real registry + op protocol, the only
 * fake being the thread boundary.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { InProcessWorker } from '../../../test/inProcessWorker';
import type { IslandHandle } from '../src/index';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/echo.worker')];

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let Island: typeof import('../src/react').Island;
beforeAll(async () => {
  ({ Island } = await import('../src/react'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });

describe('<Island/>', () => {
  it('mounts, relays events, re-props, and unmounts cleanly', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const emitted: Array<{ name: string; payload: unknown }> = [];
    let handle: IslandHandle | undefined;

    const tree = (
      <Island
        worker={renderWorker}
        app="echo"
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
          app="echo"
          props={{ text: 'updated' }}
          onEvent={(name, payload) => emitted.push({ name, payload })}
          onReady={(h) => (handle = h)}
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
          app="echo"
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
});
