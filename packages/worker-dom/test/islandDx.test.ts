// @vitest-environment happy-dom
/**
 * Dev-experience guards around mountIsland: the `worker` shorthand (one-call
 * mount that builds and owns its client), the neither-option error, and the
 * props serializability pre-flight — props ride postMessage, so a function
 * or DOM node must fail HERE, naming the key, not as a bare DataCloneError
 * inside the pool.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '../../../test/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/perf.worker')];

let mountIsland: typeof import('../src/index').mountIsland;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ mountIsland } = await import('../src/index'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/perf.worker.ts', import.meta.url), { type: 'module' });

function host(): HTMLElement {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
}

describe('mountIsland worker shorthand', () => {
  it('builds and owns its client — mounts, updates, and terminates on destroy', async () => {
    const el = host();
    const island = await mountIsland({
      worker: renderWorker,
      el,
      app: 'rcounter',
      props: { label: 'hits' },
    });
    expect(island.pid).toMatch(/^w-/);
    expect(el.querySelector('button')?.textContent).toBe('hits: 0');

    const worker = InProcessWorker.created.at(-1)!;
    island.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });

  it('rejects a mount with neither client nor worker', async () => {
    await expect(
      // @ts-expect-error — deliberately missing both options
      mountIsland({ el: host(), app: 'rcounter' }),
    ).rejects.toThrow(/pass `worker`.*or `client`/);
  });
});

describe('prop serializability guard', () => {
  it('rejects uncloneable mount props, naming the key path', async () => {
    await expect(
      mountIsland({
        worker: renderWorker,
        el: host(),
        app: 'rcounter',
        props: { onSave: () => {} },
      }),
    ).rejects.toThrow(/prop 'onSave' is not structured-cloneable/);

    await expect(
      mountIsland({
        worker: renderWorker,
        el: host(),
        app: 'rcounter',
        props: { user: { name: 'a', save: async () => {} } },
      }),
    ).rejects.toThrow(/prop 'user\.save' is not structured-cloneable/);

    // DOM nodes are the real-browser case; happy-dom elements are userland
    // objects that DO survive structuredClone, so probe with a nested
    // function — uncloneable in every environment.
    await expect(
      mountIsland({
        worker: renderWorker,
        el: host(),
        app: 'rcounter',
        props: { rows: [{ id: 1 }, { render: () => {} }] },
      }),
    ).rejects.toThrow(/prop 'rows\[1\]\.render' is not structured-cloneable/);
  });

  it('rejects uncloneable updateProps the same way', async () => {
    const island = await mountIsland({
      worker: renderWorker,
      el: host(),
      app: 'rcounter',
    });
    await expect(island.updateProps({ cb: () => 1 })).rejects.toThrow(
      /prop 'cb' is not structured-cloneable/,
    );
    island.destroy();
  });
});
