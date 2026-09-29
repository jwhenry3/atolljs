// @vitest-environment happy-dom
/**
 * `createIsland`/`Island` — mounts an island worker from a Solid shell.
 * In-process E2E like the react-island suite: real registry + op protocol,
 * the only fake being the thread boundary (InProcessWorker).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { InProcessWorker } from '@jwhenry123/mesh/sdk/testing/inProcessWorker';
import type { CreateIslandResult } from '../src/index';
import { echoApp } from './fixtures/echo.worker';

vi.stubGlobal('Worker', InProcessWorker);
// In-process workers share one module graph — importing the worker entry
// performs its defineMonoWorker/APP_REGISTRY side effects at INIT_MEMORY.
InProcessWorker.handlerModules = [() => import('./fixtures/echo.worker')];

let createIsland: typeof import('../src/index').createIsland;
let Island: typeof import('../src/index').Island;
// In-process artifact: once a worker island installs the instance dispatcher,
// ambient `document` can resolve to a instance's PROXY document — capture the
// real one before any mounts. Real browsers never share globals across threads.
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ createIsland, Island } = await import('../src/index'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });

describe('createIsland', () => {
  it('mounts via ref, relays events, re-props reactively, destroys with the owner', async () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const el = realDoc.createElement('div');
    host.appendChild(el);

    const emitted: Array<{ name: string; payload: unknown }> = [];
    const [text, setText] = createSignal('hello island');
    let island!: CreateIslandResult;
    const dispose = createRoot((dispose) => {
      island = createIsland({
        worker: renderWorker,
        app: echoApp,
        // Accessor form — the watch effect tracks `text` through it.
        props: () => ({ text: text() }),
        onEvent: (name, payload) => emitted.push({ name, payload }),
      });
      return dispose;
    });
    island.ref(el);

    // Async mount → status transition → real DOM from the worker's op stream.
    expect(island.status[0]()).toBe('mounting');
    await vi.waitFor(() => expect(island.status[0]()).toBe('ready'));
    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe('hello island'),
    );
    expect(island.handle()?.pid).toMatch(/^w-/);
    expect(emitted.some((e) => e.name === 'ready')).toBe(true);

    // Reactive props → updateProps → imperative rebuild with the new text.
    setText('updated');
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('updated'));
    // The rebuild re-runs build(), which emits 'ready' with the new props.
    await vi.waitFor(() =>
      expect(emitted.filter((e) => e.name === 'ready').at(-1)?.payload).toEqual({
        text: 'updated',
      }),
    );

    // Click → dispatch round-trip → emit → onEvent.
    el.querySelector('.ping')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'pinged')).toBe(true));

    // Imperative props push — same channel as a reactive change.
    await island.updateProps({ text: 'manual' });
    await vi.waitFor(() => expect(el.querySelector('.echo')?.textContent).toBe('manual'));

    // Dedupe: the reactive props now produce the same wire bytes as the
    // manual push — no rebuild, no new ops.
    const opsApplied = island.handle()!.opsApplied;
    setText('manual');
    await vi.waitFor(() => expect(island.handle()!.opsApplied).toBe(opsApplied));

    // Owner dispose → island destroyed → its (unshared) worker terminates.
    const worker = InProcessWorker.created.at(-1)!;
    dispose();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
    expect(island.handle()).toBeUndefined();
  });

  it('a shared client mounts two mounts into one worker — teardown is ref-counted', async () => {
    const { connectIslandWorker } = await import('@jwhenry123/mesh-islands');
    const client = connectIslandWorker({ worker: renderWorker });
    const before = InProcessWorker.created.length;

    const hostA = realDoc.createElement('div');
    const hostB = realDoc.createElement('div');
    realDoc.body.append(hostA, hostB);
    const elA = realDoc.createElement('div');
    const elB = realDoc.createElement('div');
    hostA.appendChild(elA);
    hostB.appendChild(elB);

    let islandA!: CreateIslandResult;
    let islandB!: CreateIslandResult;
    const disposeA = createRoot((dispose) => {
      islandA = createIsland({ client, props: { text: 'instance A' } });
      return dispose;
    });
    const disposeB = createRoot((dispose) => {
      islandB = createIsland({ client, props: { text: 'instance B' } });
      return dispose;
    });
    islandA.ref(elA);
    islandB.ref(elB);

    // ONE worker spawned for both islands — two mounts in the same thread.
    await vi.waitFor(() => {
      expect(elA.querySelector('.echo')?.textContent).toBe('instance A');
      expect(elB.querySelector('.echo')?.textContent).toBe('instance B');
    });
    const workers = InProcessWorker.created.slice(before);
    expect(workers).toHaveLength(1);

    // First dispose: instance A hands back to the shared worker, which LIVES.
    disposeA();
    expect(workers[0].terminated).toBe(false);

    // Last island to leave terminates the worker.
    disposeB();
    await vi.waitFor(() => expect(workers[0].terminated).toBe(true));
  });

  it('Island component returns a mounted div — no JSX needed', async () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const emitted: Array<{ name: string; payload: unknown }> = [];

    let el!: HTMLElement;
    const dispose = createRoot((dispose) => {
      el = Island({
        worker: renderWorker,
        // `document` escape hatch — ambient `document` may be a instance's
        // proxy doc after earlier mounts in this in-process suite.
        document: realDoc,
        props: { text: 'component mount' },
        onEvent: (name, payload) => emitted.push({ name, payload }),
      });
      return dispose;
    });
    host.appendChild(el);

    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe('component mount'),
    );
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'ready')).toBe(true));

    dispose();
    const worker = InProcessWorker.created.at(-1)!;
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });
});
