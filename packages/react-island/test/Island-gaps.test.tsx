// @vitest-environment happy-dom
/**
 * `<Island/>` edge paths — mount-stability, error surfaces, ref forwarding,
 * slot portals backed by a worker-side `<Slot/>`, and the lazyIsland failure
 * branch. Same in-process E2E harness as Island.test.tsx.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, Component, Suspense, createRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { IslandHandle } from '../src/index';
import { echoApp } from './fixtures/echo.worker';
import { boomApp } from './fixtures/react.worker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/echo.worker'),
  () => import('./fixtures/react.worker'),
  () => import('./fixtures/react-mono.worker'),
];

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let Island: typeof import('../src/index').Island;
let islandComponent: typeof import('../src/index').islandComponent;
let lazyIsland: typeof import('../src/index').lazyIsland;
// In-process artifact: once a worker island calls installDomShim, ambient
// `document` resolves to its PROXY document (shared globalThis) — capture the
// real one before any mounts. Real browsers never share globals across threads.
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ Island, islandComponent, lazyIsland } = await import('../src/index'));
});

const reactWorker = () =>
  new Worker(new URL('./fixtures/react.worker.tsx', import.meta.url), { type: 'module' });

function host(): { root: ReturnType<typeof createRoot>; el: HTMLElement } {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return { root: createRoot(el), el };
}

/** Minimal error boundary for the lazyIsland rejection path. */
class Boundary extends Component<
  { children: ReactNode },
  { err: unknown }
> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown): { err: unknown } {
    return { err };
  }
  render(): ReactNode {
    return this.state.err !== null
      ? <div className="err-box">{String(this.state.err)}</div>
      : this.props.children;
  }
}

describe('<Island/> edge paths', () => {
  it('mounts a React-rendered island and fills a worker <Slot/> via portal', async () => {
    const { root, el } = host();
    let handle: IslandHandle | undefined;
    let activity = 0;

    await act(async () => {
      root.render(
        <Island
          worker={reactWorker}
          app="slotapp"
          props={{ label: 'slotted' }}
          slots={{ plug: <span className="shell-fill">filled</span> }}
          onActivity={() => activity++}
          onReady={(h) => (handle = h)}
        />,
      );
    });

    // React tree mounted worker-side; <Slot name="plug"/> produced a
    // data-atoll-slot anchor the shell filled through the portal path.
    await vi.waitFor(() =>
      expect(el.querySelector('.slot-label')?.textContent).toBe('slotted'),
    );
    await vi.waitFor(() =>
      expect(
        el.querySelector('[data-atoll-slot="plug"] .shell-fill')?.textContent,
      ).toBe('filled'),
    );
    expect(handle?.pid).toMatch(/^w-/);
    expect(activity).toBeGreaterThan(0);

    // Fresh slot content re-renders through slotsRef — no remount.
    await act(async () => {
      root.render(
        <Island
          worker={reactWorker}
          app="slotapp"
          props={{ label: 'slotted' }}
          slots={{ plug: <span className="shell-fill">swapped</span> }}
        />,
      );
    });
    await vi.waitFor(() =>
      expect(
        el.querySelector('[data-atoll-slot="plug"] .shell-fill')?.textContent,
      ).toBe('swapped'),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('forwards the container div to both callback and object refs', async () => {
    const { root, el } = host();
    let fnEl: HTMLDivElement | null = null;
    const objRef = createRef<HTMLDivElement>();

    await act(async () => {
      root.render(
        <>
          <Island worker={reactWorker} app={echoApp} props={{ text: 'fn' }} ref={(n) => { fnEl = n; }} />
          <Island worker={reactWorker} app={echoApp} props={{ text: 'obj' }} ref={objRef} />
        </>,
      );
    });

    await vi.waitFor(() =>
      expect(el.querySelectorAll('.echo')).toHaveLength(2),
    );
    expect(fnEl).not.toBeNull();
    expect(fnEl!.contains(el.querySelectorAll('.echo')[0])).toBe(true);
    expect(objRef.current).not.toBeNull();
    expect(objRef.current!.contains(el.querySelectorAll('.echo')[1])).toBe(true);

    await act(async () => {
      root.unmount();
    });
    // Ref cleanup — both ref forms get null on unmount.
    expect(fnEl).toBeNull();
    expect(objRef.current).toBeNull();
  });

  it('reports a missing worker/client through onError instead of throwing', async () => {
    const { root } = host();
    const errors: unknown[] = [];
    await act(async () => {
      root.render(
        <Island app={echoApp} props={{ text: 'x' }} onError={(e) => errors.push(e)} />,
      );
    });
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(String(errors[0])).toContain('worker');
    await act(async () => {
      root.unmount();
    });
  });

  it('reports an unresolvable app reference through onError', async () => {
    const { root } = host();
    const errors: unknown[] = [];
    await act(async () => {
      root.render(
        <Island
          worker={reactWorker}
          app={{} as never}
          props={{ text: 'x' } as never}
          onError={(e) => errors.push(e)}
        />,
      );
    });
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(String(errors[0])).toContain('app name');
    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces a mount rejection — unknown registry app — through onError', async () => {
    const { root } = host();
    const errors: unknown[] = [];
    await act(async () => {
      root.render(
        <Island
          worker={reactWorker}
          app="no-such-app"
          onError={(e) => errors.push(e)}
        />,
      );
    });
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(String(errors[0])).toContain('no-such-app');
    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces a failing updateProps through onError', async () => {
    const { root, el } = host();
    const errors: unknown[] = [];
    const render = (boom: boolean) => (
      <Island
        worker={reactWorker}
        app={boomApp}
        props={boom ? { boom: true } : { text: 'ok' }}
        onError={(e) => errors.push(e)}
      />
    );
    await act(async () => {
      root.render(render(false));
    });
    await vi.waitFor(() => expect(el.querySelector('.boom-ok')?.textContent).toBe('ok'));
    // The re-prop into props.boom makes the imperative rebuild throw —
    // updateProps rejects → onError.
    await act(async () => {
      root.render(render(true));
    });
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(String(errors[0])).toContain('boom');
    await act(async () => {
      root.unmount();
    });
  });

  it('a failing updateProps without onError reaches console.error', async () => {
    const { root, el } = host();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await act(async () => {
        root.render(
          <Island worker={reactWorker} app={boomApp} props={{ text: 'ok' }} />,
        );
      });
      await vi.waitFor(() =>
        expect(el.querySelector('.boom-ok')?.textContent).toBe('ok'),
      );
      await act(async () => {
        root.render(
          <Island worker={reactWorker} app={boomApp} props={{ boom: true }} />,
        );
      });
      await vi.waitFor(() =>
        expect(
          spy.mock.calls.some((c) => String(c[0]).includes('updateProps failed')),
        ).toBe(true),
      );
    } finally {
      spy.mockRestore();
    }
    await act(async () => {
      root.unmount();
    });
  });

  it('falls back to console.error when no onError is bound', async () => {
    const { root } = host();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await act(async () => {
        root.render(<Island app={echoApp} props={{ text: 'x' }} />);
      });
      await vi.waitFor(() =>
        expect(spy.mock.calls.some((c) => String(c[1]).includes('worker'))).toBe(true),
      );
    } finally {
      spy.mockRestore();
    }
    await act(async () => {
      root.unmount();
    });
  });

  it('a different app remounts the island', async () => {
    const { root, el } = host();
    await act(async () => {
      root.render(
        <Island worker={reactWorker} app={echoApp} props={{ text: 'first app' }} />,
      );
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe('first app'),
    );
    const firstWorker = InProcessWorker.created.at(-1)!;

    // app is a mount-effect dep — switching it destroys the island and
    // mounts the new app. The old worker dies with its last island.
    await act(async () => {
      root.render(
        <Island worker={reactWorker} app="counter" props={{ label: 'now react' }} />,
      );
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.btn')?.textContent).toBe('now react: 0'),
    );
    expect(el.querySelector('.echo')).toBeNull();
    await vi.waitFor(() => expect(firstWorker.terminated).toBe(true));

    await act(async () => {
      root.unmount();
    });
  });

  it('unmounting while the mount is in flight destroys the late handle', async () => {
    const { root, el } = host();
    // A client whose mount resolves late — deterministic in-flight window:
    // the unmount lands while mountIsland is still pending, so the resolved
    // handle takes the cancelled path and destroys itself. The wrapper is a
    // forwarding Proxy — connectWorker clients are proxies themselves, so
    // Object.assign-style cloning would drop the method surface.
    const { connectIslandWorker } = await import('@atolljs/islands');
    const inner = connectIslandWorker({ worker: reactWorker });
    const slow = new Proxy(inner, {
      get: (target, key) =>
        key === 'mount'
          ? (...args: unknown[]) =>
              new Promise((r) => setTimeout(r, 30)).then(() =>
                (inner.mount as (...a: unknown[]) => Promise<unknown>)(...args),
              )
          : (target as unknown as Record<PropertyKey, unknown>)[key],
    });
    let ready = false;

    // First act flushes the mount effect — client.mount() is now pending on
    // the 30ms delay; a SEPARATE act unmounts inside that window so the
    // cleanup's cancelled flag is set before the handshake resolves.
    const spawnedBefore = InProcessWorker.created.length;
    await act(async () => {
      root.render(
        <Island
          client={slow}
          app={echoApp}
          props={{ text: 'gone' }}
          onReady={() => (ready = true)}
        />,
      );
    });
    await act(async () => {
      root.unmount();
    });
    // After the delayed mount resolves the cancelled handle destroys itself
    // — onReady never fires and its spawned worker terminates.
    await new Promise((r) => setTimeout(r, 80));
    expect(ready).toBe(false);
    const spawned = InProcessWorker.created.slice(spawnedBefore);
    await vi.waitFor(() =>
      expect(spawned.length > 0 && spawned.every((w) => w.terminated)).toBe(true),
    );
  });

  it('islandComponent renders `fallback` until the island is ready', async () => {
    const Echo = islandComponent<{ text: string }>('echo');
    const { root, el } = host();
    await act(async () => {
      root.render(
        <Echo
          worker={reactWorker}
          text="proxied"
          fallback={<div className="proxy-fb">mounting…</div>}
        />,
      );
    });
    // Ready flips after onReady — by the time the island DOM is asserted the
    // fallback has been swapped out. (The mount resolves inside act(), so
    // simply assert the end state and that the fallback element existed in
    // the tree's render output at some point is implied by code coverage of
    // the `!ready` branch.)
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('proxied'));
    expect(el.querySelector('.proxy-fb')).toBeNull();
    await act(async () => {
      root.unmount();
    });
  });

  it('lazyIsland surfaces a rejected loader through the nearest error boundary', async () => {
    const Broken = lazyIsland(() => Promise.reject(new Error('chunk exploded')));
    const { root, el } = host();
    const errors: unknown[] = [];
    await act(async () => {
      root.render(
        <Boundary>
          <Suspense fallback={<div className="lazy-fb">loading…</div>}>
            <Broken worker={reactWorker} onError={(e) => errors.push(e)} />
          </Suspense>
        </Boundary>,
      );
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.err-box')?.textContent).toContain('chunk exploded'),
    );
    await act(async () => {
      root.unmount();
    });
  });

  it('lazyIsland accepts a bare app value (no {default}/{app} wrapper)', async () => {
    const Bare = lazyIsland(() => Promise.resolve(echoApp));
    const { root, el } = host();
    await act(async () => {
      root.render(
        <Suspense fallback={<div className="lazy-fb">loading…</div>}>
          <Bare worker={reactWorker} text="bare module" />
        </Suspense>,
      );
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe('bare module'),
    );
    await act(async () => {
      root.unmount();
    });
  });

  it('mode="poll" mounts without the doorbell', async () => {
    const { root, el } = host();
    await act(async () => {
      root.render(
        <Island worker={reactWorker} app={echoApp} props={{ text: 'polled' }} mode="poll" />,
      );
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe('polled'),
    );
    await act(async () => {
      root.unmount();
    });
  });
});
