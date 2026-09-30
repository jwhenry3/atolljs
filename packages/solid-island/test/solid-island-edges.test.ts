// @vitest-environment happy-dom
/**
 * `createIsland` edge paths — app-name resolution failures, missing
 * worker/client, mount-time rejections, pre-mount pendingProps, in-flight
 * catch-up props, mid-mount disposal, ref rebinding, and updateProps
 * error reporting. Driven against the echo imperative fixture.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { CreateIslandResult } from '../src/index';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/echo.worker')];

let createIsland: typeof import('../src/index').createIsland;
// In-process artifact: capture the real document before a instance's proxy
// document can claim the ambient global.
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ createIsland } = await import('../src/index'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });

const hostEl = (): HTMLElement => {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
};

describe('createIsland — error paths', () => {
  it('fails when the app reference resolves to no name', async () => {
    const errors: unknown[] = [];
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({
        worker: renderWorker,
        // An object reference carries no stamp/imperative — unresolvable.
        app: {} as never,
        onError: (err) => errors.push(err),
      });
      return d;
    });
    island.ref(hostEl());
    await vi.waitFor(() => expect(island.status[0]()).toBe('error'));
    expect(String(island.error())).toMatch(/could not resolve an app name/);
    expect(errors).toHaveLength(1);
    dispose();
  });

  it('fails when neither worker nor client is given', async () => {
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({ app: 'echo' });
      return d;
    });
    island.ref(hostEl());
    await vi.waitFor(() => expect(island.status[0]()).toBe('error'));
    expect(String(island.error())).toMatch(/requires either `worker` or `client`/);
    dispose();
  });

  it('reports a mount-time rejection (uncloneable props) via console.error by default', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({
        worker: renderWorker,
        app: 'echo',
        // A raw function can't cross postMessage — mountIsland throws.
        props: { fn: () => {} } as never,
      });
      return d;
    });
    island.ref(hostEl());
    await vi.waitFor(() => expect(island.status[0]()).toBe('error'));
    expect(island.error()).toBeTruthy();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    dispose();
  });
});

describe('createIsland — lifecycle edges', () => {
  it('updateProps before ref folds into the mount (pendingProps)', async () => {
    const [text, setText] = createSignal('stale');
    const el = hostEl();
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({
        worker: renderWorker,
        app: 'echo',
        props: () => ({ text: text() }),
      });
      return d;
    });
    // Pre-ref: island is undefined — the push is queued, not dropped.
    await island.updateProps({ text: 'early' });
    // The reactive props source is authoritative — the post-mount reconcile
    // would overwrite the folded props with the accessor's value had it
    // diverged, so it must agree here.
    setText('early');
    island.ref(el);
    await vi.waitFor(() => expect(island.status[0]()).toBe('ready'));
    expect(el.querySelector('.echo')?.textContent).toBe('early');
    dispose();
  });

  it('props changed mid-mount are caught up after the mount resolves', async () => {
    const el = hostEl();
    const [text, setText] = createSignal('a');
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({
        worker: renderWorker,
        app: 'echo',
        props: () => ({ text: text() }),
      });
      return d;
    });
    island.ref(el);
    // Synchronous change while the mount round-trip is in flight — the
    // post-mount catch-up re-reads and pushes the newer props.
    setText('b');
    await vi.waitFor(() => expect(island.status[0]()).toBe('ready'));
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('b'));
    dispose();
  });

  it('disposing the owner mid-mount self-destructs the resolved island', async () => {
    const el = hostEl();
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({ worker: renderWorker, app: 'echo' });
      return d;
    });
    island.ref(el);
    const worker = InProcessWorker.created.at(-1)!;
    // Dispose before the mount resolves — the resolved handle is destroyed
    // instead of attaching a zombie.
    dispose();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
    expect(island.status[0]()).toBe('mounting');
    // The mount batch already applied before the disposed check — destroy's
    // `clear` op is discarded (`void client.unmount`), so the DOM the dead
    // island wrote stays behind.
    expect(el.querySelector('.echo')).not.toBeNull();
  });

  it('disposing during the catch-up updateProps leaves status mounting', async () => {
    const el = hostEl();
    const [text, setText] = createSignal('a');
    let readies = 0;
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({
        worker: renderWorker,
        app: 'echo',
        props: () => ({ text: text() }),
        // The mount batch emits 'ready' #1; the catch-up updateProps
        // rebuild emits 'ready' #2 INSIDE the awaited updateProps —
        // disposing there must abort the ready transition.
        onEvent: (name) => {
          if (name === 'ready' && ++readies >= 2) dispose();
        },
      });
      return d;
    });
    island.ref(el);
    setText('b'); // guarantees a catch-up updateProps after mount
    const worker = InProcessWorker.created.at(-1)!;
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
    expect(readies).toBe(2);
    expect(island.status[0]()).toBe('mounting');
  });

  it('rebinding ref to a different element remounts the island', async () => {
    const elA = hostEl();
    const elB = hostEl();
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({ worker: renderWorker, app: 'echo', props: { text: 'move' } });
      return d;
    });
    island.ref(elA);
    await vi.waitFor(() => expect(elA.querySelector('.echo')?.textContent).toBe('move'));
    const first = island.handle()!;

    island.ref(elB);
    await vi.waitFor(() => expect(elB.querySelector('.echo')?.textContent).toBe('move'));
    // A fresh handle replaced the destroyed one; binding the SAME element
    // again is a no-op.
    const second = island.handle()!;
    expect(second).not.toBe(first);
    island.ref(elB);
    expect(island.handle()).toBe(second);
    dispose();
  });

  it('a ready island reports updateProps failures through onError', async () => {
    const el = hostEl();
    const errors: unknown[] = [];
    const [text, setText] = createSignal('a');
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({
        worker: renderWorker,
        app: 'echo',
        props: () => ({ text: text() }),
        onError: (err) => errors.push(err),
      });
      return d;
    });
    island.ref(el);
    await vi.waitFor(() => expect(island.status[0]()).toBe('ready'));
    // Destroy the mounted handle out from under the binding — the next
    // reactive props push rejects (instance gone / worker terminated) and
    // lands on onError.
    island.handle()!.destroy();
    setText('b');
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(island.error()).toBeTruthy();
    dispose();
  });

  it('onActivity fires on applied op batches; slots hand back slot elements', async () => {
    const el = hostEl();
    let activity = 0;
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({
        worker: renderWorker,
        app: 'echo',
        props: { text: 'act' },
        onActivity: () => activity++,
        slots: {},
      });
      return d;
    });
    island.ref(el);
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('act'));
    expect(activity).toBeGreaterThan(0);
    dispose();
  });

  it('omitted app resolves to main — the sole-app fallback mounts it', async () => {
    const el = hostEl();
    let island!: CreateIslandResult;
    const dispose = createRoot((d) => {
      island = createIsland({
        worker: renderWorker,
        workerOptions: {},
        props: { text: 'noapp' },
      });
      return d;
    });
    island.ref(el);
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('noapp'));
    expect(island.status[0]()).toBe('ready');
    dispose();
  });
});
