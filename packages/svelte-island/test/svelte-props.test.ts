// @vitest-environment happy-dom
/**
 * createPropsBox deletion branch + svelteIsland stamping — updateProps with
 * a prop set missing a previously-present key must DELETE it from the
 * $state record (fine-grained: the same node updates in place). Also
 * asserts the `svelteIsland` stamp surface (islandAppName) without a second
 * svelteMount — the known double-mount bug limits this file to one mount.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { islandAppNameOf } from '@atolljs/islands';
import type { IslandHandle } from '@atolljs/islands';
import { stampedApp } from './fixtures/extras.worker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/extras.worker')];

let mountIsland: typeof import('@atolljs/islands').mountIsland;
let connectIslandWorker: typeof import('@atolljs/islands').connectIslandWorker;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ connectIslandWorker, mountIsland } = await import('@atolljs/islands'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/extras.worker.ts', import.meta.url), { type: 'module' });

describe('svelteIsland stamp', () => {
  it('marks the wrapped app with its registry name', () => {
    expect(stampedApp.islandAppName).toBe('stamped');
    expect(islandAppNameOf(stampedApp)).toBe('stamped');
  });
});

describe('createPropsBox.update', () => {
  it('deletes keys absent from the next prop set, in place', async () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);

    const island: IslandHandle = await mountIsland({
      client: connectIslandWorker({ worker: renderWorker }),
      el: host,
      app: 'propsbox',
      props: { label: 'one', gone: 'present' },
    });
    const pb = host.querySelector('.pb')!;
    expect(pb.textContent).toBe('one|present');

    // The 'gone' key disappears from the prop set — box.update deletes it
    // from the $state record and flushSync patches the same <p> in place.
    await island.updateProps({ label: 'two' });
    expect(pb.textContent).toBe('two|deleted');
    expect(host.querySelector('.pb')).toBe(pb);

    // Re-introducing a deleted key writes it back.
    await island.updateProps({ label: 'two', gone: 'back' });
    expect(pb.textContent).toBe('two|back');
    expect(host.querySelector('.pb')).toBe(pb);

    island.destroy();
  });
});
