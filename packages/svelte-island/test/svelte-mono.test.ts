// @vitest-environment happy-dom
/**
 * `defineSvelteMonoWorker` — the 1:1 host shape: nameless mounts resolve
 * the single registered app through svelteIslandApp.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { IslandHandle } from '@atolljs/islands';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/mono.worker')];

let mountIsland: typeof import('@atolljs/islands').mountIsland;
let connectIslandWorker: typeof import('@atolljs/islands').connectIslandWorker;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ connectIslandWorker, mountIsland } = await import('@atolljs/islands'));
});

const monoWorker = () =>
  new Worker(new URL('./fixtures/mono.worker.ts', import.meta.url), { type: 'module' });

describe('defineSvelteMonoWorker', () => {
  it('mounts its single app namelessly and patches props', async () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);

    const island: IslandHandle = await mountIsland({
      client: connectIslandWorker({ worker: monoWorker }),
      el: host,
      props: { label: 'monomount' },
    });
    await vi.waitFor(() =>
      expect(host.querySelector('.mono')?.textContent).toBe('monomount'),
    );

    await island.updateProps({ label: 'renamed' });
    await vi.waitFor(() =>
      expect(host.querySelector('.mono')?.textContent).toBe('renamed'),
    );
    island.destroy();
  });
});
