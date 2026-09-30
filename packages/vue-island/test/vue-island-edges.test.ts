// @vitest-environment happy-dom
/**
 * `useIsland` + `<AtollIsland/>` edge paths — missing client/worker,
 * unresolvable apps, mount rejections, mid-mount host swaps (generation
 * guard), host teardown/remount, in-flight props catch-up, and updateProps
 * error reporting.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, h, nextTick, reactive, ref } from 'vue';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { connectIslandWorker } from '@atolljs/islands';
import type { IslandHandle } from '../src/index';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/echo.worker'),
  () => import('./fixtures/mono.worker'),
];

let AtollIsland: typeof import('../src/index').AtollIsland;
let useIsland: typeof import('../src/index').useIsland;
// In-process artifact: capture the real document before a instance's proxy
// document can claim the ambient global.
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ AtollIsland, useIsland } = await import('../src/index'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });

const hostEl = (): HTMLElement => {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
};

describe('useIsland — error paths', () => {
  it('fails with no client and no worker', async () => {
    const errors: unknown[] = [];
    const island = useIsland({ app: 'echo', onError: (e) => errors.push(e) });
    island.host.value = hostEl();
    await vi.waitFor(() => expect(island.status.value).toBe('error'));
    expect(String(island.error.value)).toMatch(/requires either `client` or `worker`/);
    expect(errors).toHaveLength(1);
  });

  it('fails when the app reference resolves to no name — console.error default', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = connectIslandWorker({ worker: renderWorker });
    const island = useIsland({ client, app: {} as never });
    island.host.value = hostEl();
    await vi.waitFor(() => expect(island.status.value).toBe('error'));
    expect(String(island.error.value)).toMatch(/could not resolve an app name/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    island.host.value = null;
  });

  it('reports mount-time rejections (unknown app name)', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    const errors: unknown[] = [];
    const island = useIsland({
      client,
      // Registry has echo/main/stamped — 'missing' resolves to nothing and
      // the worker's mount task throws.
      app: 'missing',
      onError: (e) => errors.push(e),
    });
    island.host.value = hostEl();
    await vi.waitFor(() => expect(island.status.value).toBe('error'));
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/unknown app/);
  });
});

describe('useIsland — lifecycle edges', () => {
  it('swapping hosts mid-mount destroys the stale mount (generation guard)', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    const island = useIsland({ client, app: 'echo', props: { text: 'gen' } });
    const elA = hostEl();
    const elB = hostEl();

    island.host.value = elA;
    await nextTick(); // mount(elA, gen=1) is in flight
    island.host.value = elB;
    await nextTick(); // watcher: gen=2 → mount(elB)

    await vi.waitFor(() => expect(island.status.value).toBe('ready'));
    await vi.waitFor(() => expect(elB.querySelector('.echo')?.textContent).toBe('gen'));
    expect(island.handle.value?.pid).toMatch(/^w-/);
    // One worker, refcount back to a single live island.
    const worker = InProcessWorker.created.at(-1)!;

    island.host.value = null; // teardown
    await vi.waitFor(() => expect(island.handle.value).toBeNull());
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });

  it('host → null destroys; a later non-null host remounts', async () => {
    const client = connectIslandWorker({ worker: renderWorker });
    const island = useIsland({ client, app: 'echo', props: { text: 'flip' } });
    const elA = hostEl();
    island.host.value = elA;
    await vi.waitFor(() => expect(elA.querySelector('.echo')?.textContent).toBe('flip'));

    island.host.value = null;
    await vi.waitFor(() => expect(island.handle.value).toBeNull());
    // Host gone → island destroyed → 'idle' until the next host lands.
    expect(island.status.value).toBe('idle');

    const elB = hostEl();
    island.host.value = elB;
    await vi.waitFor(() => expect(elB.querySelector('.echo')?.textContent).toBe('flip'));
    expect(island.status.value).toBe('ready');
    island.host.value = null;
  });

  it('props read during mount are reconciled — a changing getter forces the catch-up', async () => {
    let i = 0;
    const reads: number[] = [];
    const client = connectIslandWorker({ worker: renderWorker });
    const island = useIsland({
      client,
      app: 'echo',
      // Every read moves — mountedJson vs latestJson diverge, forcing the
      // post-mount updateProps reconcile.
      props: () => {
        reads.push(i);
        return { text: `v${i++}` };
      },
    });
    const el = hostEl();
    island.host.value = el;
    await vi.waitFor(() => expect(island.status.value).toBe('ready'));
    // The island reflects the LAST read (the reconcile), not what mount
    // serialized — assert dynamically so extra reads don't flake.
    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe(`v${reads.at(-1)}`),
    );
    expect(reads.length).toBeGreaterThanOrEqual(3);
    island.host.value = null;
  });

  it('reactive props mutated while the mount is in flight land via catch-up', async () => {
    const props = reactive({ text: 'a' });
    const client = connectIslandWorker({ worker: renderWorker });
    const island = useIsland({ client, app: 'echo', props });
    const el = hostEl();
    island.host.value = el;
    await nextTick(); // mount in flight — island still null
    props.text = 'inflight'; // props watcher fires with mounted === null
    await nextTick();
    await vi.waitFor(() => expect(island.status.value).toBe('ready'));
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('inflight'));
    island.host.value = null;
  });

  it('updateProps failures route to onError', async () => {
    const props = reactive({ text: 'a' });
    const errors: unknown[] = [];
    const client = connectIslandWorker({ worker: renderWorker });
    const island = useIsland({ client, app: 'echo', props, onError: (e) => errors.push(e) });
    const el = hostEl();
    island.host.value = el;
    await vi.waitFor(() => expect(island.status.value).toBe('ready'));
    // Destroy the live handle underneath — the next reactive push rejects.
    island.handle.value!.destroy();
    props.text = 'b';
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    // Update failures report like mount failures — status + error, onError.
    expect(island.error.value).toBeTruthy();
    expect(island.status.value).toBe('error');
  });

  it('updateProps failures default to console.error without onError', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const props = reactive({ text: 'a' });
    const client = connectIslandWorker({ worker: renderWorker });
    const island = useIsland({ client, app: 'echo', props });
    const el = hostEl();
    island.host.value = el;
    await vi.waitFor(() => expect(island.status.value).toBe('ready'));
    island.handle.value!.destroy();
    props.text = 'b';
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });

  it('omitted app resolves to main — mounts the mono app of that name', async () => {
    // The `worker` (non-client) path exercises `connectIslandWorker` +
    // workerOptions forwarding inside useIsland.
    const island = useIsland({ worker: renderWorker, workerOptions: {}, props: { tag: 'x' } });
    const el = hostEl();
    island.host.value = el;
    await vi.waitFor(() => expect(el.querySelector('.mono')?.textContent).toBe('mono:x'));
    island.host.value = null;
  });

  it('runs without an effect scope — no scope-dispose wiring', async () => {
    // Called outside effectScope/setup → getCurrentScope() is undefined.
    const client = connectIslandWorker({ worker: renderWorker });
    const island = useIsland({ client, app: 'echo', props: { text: 'free' } });
    const el = hostEl();
    island.host.value = el;
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('free'));
    island.host.value = null;
  });
});

describe('<AtollIsland/> — callback wiring', () => {
  it('reads onEvent/onActivity/onReady/onError through props', async () => {
    const host = hostEl();
    const emitted: Array<{ name: string }> = [];
    let activity = 0;
    let handle: IslandHandle | undefined;
    const errors: unknown[] = [];
    const client = connectIslandWorker({ worker: renderWorker });
    const props = reactive({ text: 'wired' });

    const app = createApp({
      render: () =>
        h(AtollIsland, {
          client,
          app: 'echo',
          props,
          onEvent: (name: string) => emitted.push({ name }),
          onActivity: () => activity++,
          onReady: (h2: IslandHandle) => {
            handle = h2;
          },
          onError: (err: unknown) => errors.push(err),
        }),
    });
    app.mount(host);

    await vi.waitFor(() => expect(host.querySelector('.echo')?.textContent).toBe('wired'));
    expect(emitted.some((e) => e.name === 'ready')).toBe(true);
    expect(activity).toBeGreaterThan(0);
    expect(handle?.pid).toMatch(/^w-/);
    expect(errors).toHaveLength(0);
    app.unmount();
  });

  it('mounts a stamped islandApp reference', async () => {
    const { stampedApp } = await import('./fixtures/mono.worker');
    const host = hostEl();
    const client = connectIslandWorker({ worker: renderWorker });
    const app = createApp({
      render: () => h(AtollIsland, { client, app: stampedApp as never }),
    });
    app.mount(host);
    await vi.waitFor(() => expect(host.querySelector('.stamped')?.textContent).toBe('stamped!'));
    app.unmount();
  });

  it('useIsland accepts the stamped reference too', async () => {
    const { stampedApp } = await import('./fixtures/mono.worker');
    const scope = effectScope();
    const client = connectIslandWorker({ worker: renderWorker });
    const island = scope.run(() =>
      useIsland({ client, app: stampedApp as never }),
    )!;
    island.host.value = hostEl();
    await vi.waitFor(() => expect(island.status.value).toBe('ready'));
    scope.stop();
  });
});
