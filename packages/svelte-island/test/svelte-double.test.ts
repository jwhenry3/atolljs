// @vitest-environment happy-dom
/**
 * KNOWN BUG — a second `svelteMount` in one module graph renders nothing.
 *
 * Two mounts of the same compiled component (two clients → two workers, one
 * shared module graph — the shape a poly worker with two svelte islands has
 * in production) leave the second host empty: mount resolves, a handful of
 * ops cross, no DOM. First mount is always fine.
 *
 * `it.fails` is the regression marker: when the adapter handles second
 * mounts this test starts passing and vitest flags it for un-marking.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { counterApp } from './fixtures/counter.worker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/counter.worker')];

let mountIsland: typeof import('@atolljs/islands').mountIsland;
let connectIslandWorker: typeof import('@atolljs/islands').connectIslandWorker;
beforeAll(async () => {
  ({ connectIslandWorker, mountIsland } = await import('@atolljs/islands'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/counter.worker.ts', import.meta.url), { type: 'module' });

describe('svelteIslandApp', () => {
  it.fails('mounts the same component into two islands', async () => {
    const h1 = document.createElement('div');
    const h2 = document.createElement('div');
    document.body.append(h1, h2);
    const i1 = await mountIsland({
      client: connectIslandWorker({ worker: renderWorker }),
      el: h1,
      app: counterApp.islandAppName,
      props: { label: 'one' },
    });
    expect(h1.querySelector('.lbl')?.textContent).toBe('one: 0');
    const i2 = await mountIsland({
      client: connectIslandWorker({ worker: renderWorker }),
      el: h2,
      app: counterApp.islandAppName,
      props: { label: 'two' },
    });
    await vi.waitFor(() =>
      expect(h2.querySelector('.lbl')?.textContent).toBe('two: 0'),
    );
    i1.destroy();
    i2.destroy();
  });
});
