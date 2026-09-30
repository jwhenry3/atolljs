// @vitest-environment happy-dom
/**
 * `use:island` coverage gaps — the action branches svelte-island.test.ts
 * doesn't touch:
 *
 *   - unresolvable `app` reference → report + the noopAction surface
 *     (update/destroy still track latest and fire onDestroy)
 *   - mount failure → onError (and console.error without it)
 *   - `props` update while the mount is in flight → coalesced pendingProps
 *     flush once the handle lands
 *   - updateProps rejection → report()
 *   - destroy while mounting → the late handle self-destroys, onReady never
 *     fires, and the catch arm stays quiet
 *   - slots through the latest-map proxy — an update() swaps the callback
 *   - onActivity fires per applied op batch
 *   - `app`/`worker`/`client` are mount-stable — update() does not remount
 *   - createIslandState error path (status 'error', error recorded)
 *
 * All mounts use IMPERATIVE apps — the known second-svelteMount bug
 * (svelte-double.test.ts) doesn't constrain imperative instances.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { IslandClient, IslandHandle } from '../src/index';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/echo.worker'),
  () => import('./fixtures/dom-extras.worker'),
];

let island: typeof import('../src/index').island;
let createIslandState: typeof import('../src/index').createIslandState;
let connectIslandWorker: typeof import('@atolljs/islands').connectIslandWorker;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ island, createIslandState } = await import('../src/index'));
  ({ connectIslandWorker } = await import('@atolljs/islands'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });
const extrasWorker = () =>
  new Worker(new URL('./fixtures/dom-extras.worker.ts', import.meta.url), { type: 'module' });
const islandClient = (worker = renderWorker): IslandClient =>
  connectIslandWorker({ worker });

const host = (): HTMLElement => {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
};

describe('unusable configuration', () => {
  it('an unstamped app object reports the resolution error and noops', () => {
    const el = host();
    const errors: unknown[] = [];
    let destroyed = false;
    const action = island(el, {
      client: islandClient(),
      // A bare object — no islandAppName, no derivable name.
      app: { imperative: undefined } as never,
      onError: (err) => errors.push(err),
      onDestroy: () => (destroyed = true),
    });

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('could not resolve an app name');

    // The noop action still tracks latest and reports destroys sanely.
    action!.update!({
      client: islandClient(),
      app: { imperative: undefined } as never,
      onError: (err) => errors.push(err),
      onDestroy: () => (destroyed = true),
    });
    expect(el.children).toHaveLength(0);
    action!.destroy!();
    expect(destroyed).toBe(true);
  });

  it('missing worker/client without onError falls back to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = host();
    const action = island(el, {});
    expect(
      spy.mock.calls.some((args) =>
        args.some((a) => String(a).includes('requires either `worker` or `client`')),
      ),
    ).toBe(true);
    action!.destroy!();
    spy.mockRestore();
  });
});

describe('mount failure', () => {
  it('worker-side throws reach onError and record state.error', async () => {
    const el = host();
    const state = createIslandState();
    const action = island(el, {
      client: islandClient(extrasWorker),
      app: 'boomer',
      props: { boom: true },
      onMount: state.onMount,
      onReady: state.onReady,
      onError: state.onError,
      onDestroy: state.onDestroy,
    });

    expect(state.status).toBe('mounting');
    await vi.waitFor(() => expect(state.status).toBe('error'));
    expect(String(state.error)).toContain('boomer exploded');
    expect(el.children).toHaveLength(0);
    action!.destroy!();
    expect(state.status).toBe('destroyed');
  });

  it('worker-side throws without onError reach console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = host();
    const action = island(el, {
      client: islandClient(extrasWorker),
      app: 'boomer',
      props: { boom: true },
    });
    await vi.waitFor(() =>
      expect(
        spy.mock.calls.some((args) =>
          args.some((a) => String(a).includes('boomer exploded')),
        ),
      ).toBe(true),
    );
    action!.destroy!();
    spy.mockRestore();
  });
});

describe('in-flight mount window', () => {
  it('coalesces props updates arriving before the mount resolves', async () => {
    const el = host();
    let handle: IslandHandle | undefined;
    const action = island(el, {
      client: islandClient(),
      app: 'echo',
      props: { text: 'first' },
      onReady: (h) => (handle = h),
    });
    // Synchronous update while mountIsland is still resolving → pendingProps.
    action!.update!({
      client: islandClient(),
      app: 'echo',
      props: { text: 'flushed-after-ready' },
      onReady: (h) => (handle = h),
    });

    await vi.waitFor(() => {
      expect(handle).toBeDefined();
      expect(el.querySelector('.echo')?.textContent).toBe('flushed-after-ready');
    });
    action!.destroy!();
  });

  it('destroying mid-mount self-destructs the late handle quietly', async () => {
    const spawnedBefore = InProcessWorker.created.length;
    const el = host();
    let ready = false;
    const action = island(el, {
      client: islandClient(),
      app: 'echo',
      props: { text: 'gone' },
      onReady: () => (ready = true),
    });
    action!.destroy!(); // destroy() while mountIsland is still resolving

    await new Promise((r) => setTimeout(r, 50));
    expect(ready).toBe(false);
    const spawned = InProcessWorker.created.slice(spawnedBefore);
    await vi.waitFor(() =>
      expect(spawned.length > 0 && spawned.every((w) => w.terminated)).toBe(true),
    );
  });
});

describe('updateProps failure', () => {
  it('a rejected update routes to onError', async () => {
    const el = host();
    const errors: unknown[] = [];
    const client = islandClient(extrasWorker);
    const action = island(el, {
      client,
      app: 'boomer',
      props: { text: 'stable' },
      onError: (err) => errors.push(err),
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.boomer-ok')?.textContent).toBe('stable'),
    );

    action!.update!({ client, app: 'boomer', props: { boom: true }, onError: (e) => errors.push(e) });
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(String(errors[0])).toContain('boomer exploded');
    action!.destroy!();
  });
});

describe('slots through the latest-map proxy', () => {
  it('mounts anchors via the current slots map — swappable by update()', async () => {
    const el = host();
    const first: Array<HTMLElement | null> = [];
    const second: Array<HTMLElement | null> = [];
    const client = islandClient(extrasWorker);
    const action = island(el, {
      client,
      app: 'slotter',
      props: { text: 'v1' },
      slots: { plug: (n) => first.push(n) },
    });
    await vi.waitFor(() => expect(first.some((c) => c !== null)).toBe(true));

    // Swap the slot map AND props in one update — the imperative rebuild
    // creates a fresh anchor, delivered through the NEW callback.
    action!.update!({
      client,
      app: 'slotter',
      props: { text: 'v2' },
      slots: { plug: (n) => second.push(n) },
    });
    await vi.waitFor(() => {
      expect(el.querySelector('.plug-label')?.textContent).toBe('v2');
      expect(second.some((c) => c !== null)).toBe(true);
    });
    action!.destroy!();
  });
});

describe('onActivity + mount-stable inputs', () => {
  it('fires per applied batch; app/worker changes on update() never remount', async () => {
    const el = host();
    let activity = 0;
    const spawnedBefore = InProcessWorker.created.length;
    const client = islandClient();
    const action = island(el, {
      client,
      app: 'echo',
      props: { text: 'stable-inputs' },
      onActivity: () => activity++,
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.echo')?.textContent).toBe('stable-inputs'),
    );
    const afterMount = activity;
    expect(afterMount).toBeGreaterThan(0);
    const workersAfterMount = InProcessWorker.created.length;

    // update() with a DIFFERENT app/worker/client — mount-stable inputs are
    // ignored: no remount, no new worker, DOM unchanged.
    action!.update!({
      client: islandClient(extrasWorker),
      app: 'slotter',
      props: { text: 'stable-inputs' },
      onActivity: () => activity++,
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(el.querySelector('.echo')?.textContent).toBe('stable-inputs');
    expect(el.querySelector('.plug-label')).toBeNull();
    expect(InProcessWorker.created.length).toBe(workersAfterMount);

    // A real props update still reaches the ORIGINAL island.
    action!.update!({
      client,
      app: 'echo',
      props: { text: 'still-echo' },
      onActivity: () => activity++,
    });
    await vi.waitFor(() => {
      expect(el.querySelector('.echo')?.textContent).toBe('still-echo');
      expect(activity).toBeGreaterThan(afterMount);
    });
    action!.destroy!();
    expect(spawnedBefore).toBeLessThan(InProcessWorker.created.length);
  });
});
