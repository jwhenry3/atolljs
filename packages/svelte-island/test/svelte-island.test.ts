// @vitest-environment happy-dom
/**
 * `use:island` — the Svelte action mounting a worker island from a Svelte
 * shell. In-process E2E like the react-island suite: real registry + op
 * protocol, the only fake being the thread boundary (InProcessWorker runs
 * the worker entry's defineMonoWorker in this module graph).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/sdk/testing/inProcessWorker';
import type { IslandHandle } from '../src/index';
import { echoApp } from './fixtures/echo.worker';

vi.stubGlobal('Worker', InProcessWorker);
// In-process workers share one module graph — importing the entry performs
// its defineMonoWorker registration, exactly what a bundled worker does.
InProcessWorker.handlerModules = [() => import('./fixtures/echo.worker')];

let island: typeof import('../src/index').island;
let createIslandState: typeof import('../src/index').createIslandState;
let connectIslandWorker: typeof import('@atolljs/islands').connectIslandWorker;
// In-process artifact: a mounted imperative instance can point the ambient
// `document` at its PROXY document (shared globalThis) — capture the real
// one before any mounts. Real browsers never share globals across threads.
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ island, createIslandState } = await import('../src/index'));
  ({ connectIslandWorker } = await import('@atolljs/islands'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });
const islandClient = () => connectIslandWorker({ worker: renderWorker });

describe('use:island', () => {
  it('mounts via the action, relays events, re-props on update, destroys cleanly', async () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const emitted: Array<{ name: string; payload: unknown }> = [];
    const onEvent = (name: string, payload: unknown): void => {
      emitted.push({ name, payload });
    };
    let handle: IslandHandle | undefined;
    let destroyed = false;

    const client = islandClient();
    const action = island(host, {
      client,
      app: echoApp, // the stamped reference — resolves to the 'echo' registry key
      props: { text: 'hello island' },
      onEvent,
      onReady: (h) => (handle = h),
      onDestroy: () => (destroyed = true),
    });

    // Async mount → real DOM replayed from the worker's op stream, and the
    // fixture's 'ready' emit lands on onEvent via the mount op batch.
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('hello island'),
    );
    expect(handle?.pid).toMatch(/^w-/);
    expect(
      emitted.some(
        (e) => e.name === 'ready' && (e.payload as { text: string }).text === 'hello island',
      ),
    ).toBe(true);

    // Click → dispatch round-trip → the worker handler's emit → onEvent.
    host.querySelector('.ping')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'pinged')).toBe(true));

    // update() → updateProps → imperative rebuild with the new text (the
    // rebuild emits 'ready' again with the new payload).
    action!.update!({
      client,
      app: echoApp,
      props: { text: 'updated' },
      onEvent,
      onDestroy: () => (destroyed = true),
    });
    await vi.waitFor(() => expect(host.querySelector('.echo')?.textContent).toBe('updated'));
    await vi.waitFor(() =>
      expect(
        emitted.some(
          (e) => e.name === 'ready' && (e.payload as { text: string }).text === 'updated',
        ),
      ).toBe(true),
    );

    // Re-applying equal props must NOT hit updateProps again — the action
    // dedupes on wire-serialized identity.
    const opsApplied = handle!.opsApplied;
    action!.update!({
      client,
      app: echoApp,
      props: { text: 'updated' },
      onEvent,
      onDestroy: () => (destroyed = true),
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(handle!.opsApplied).toBe(opsApplied);

    // destroy → the island tears down; as the client's only mount its
    // worker terminates.
    const worker = InProcessWorker.created.at(-1)!;
    action!.destroy!();
    expect(destroyed).toBe(true);
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });

  it('accepts a worker factory and mounts a instance worker namelessly', async () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);

    // No `app`, no `client` — the action builds the client and the 1:1
    // instance worker resolves its single app ('main' by default).
    const action = island(host, { worker: renderWorker, props: { text: 'via worker' } });
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('via worker'),
    );
    action!.destroy!();
  });

  it('reports a missing worker/client through onError instead of throwing', () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const errors: unknown[] = [];
    const action = island(host, { onError: (err) => errors.push(err) });
    expect(errors.length).toBe(1);
    expect(String(errors[0])).toContain('worker');
    action!.destroy!();
  });
});

describe('createIslandState', () => {
  it('tracks status/error/handle through the lifecycle callbacks', async () => {
    const state = createIslandState();
    expect(state.status).toBe('idle');

    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const action = island(host, {
      client: islandClient(),
      app: 'echo',
      props: { text: 'stateful' },
      // Spread of the state object's callbacks — its getters land as inert
      // values the action ignores; the live reads stay on `state` itself.
      onMount: state.onMount,
      onReady: state.onReady,
      onError: state.onError,
      onDestroy: state.onDestroy,
    });
    expect(state.status).toBe('mounting');

    await vi.waitFor(() => expect(state.status).toBe('ready'));
    expect(state.handle?.pid).toMatch(/^w-/);
    expect(host.querySelector('.echo')?.textContent).toBe('stateful');

    action!.destroy!();
    expect(state.status).toBe('destroyed');
    expect(state.handle).toBeNull();
  });
});
