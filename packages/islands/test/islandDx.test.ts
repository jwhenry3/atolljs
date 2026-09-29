// @vitest-environment happy-dom
/**
 * Dev-experience guards around mountIsland: the `worker` shorthand (one-call
 * mount that builds and owns its client), the neither-option error, and the
 * props serializability pre-flight — props ride postMessage, so a function
 * or DOM node must fail HERE, naming the key, not as a bare DataCloneError
 * inside the pool.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/perf.worker')];

let mountIsland: typeof import('../src/index').mountIsland;
let connectIslandWorker: typeof import('../src/index').connectIslandWorker;
let callbackProp: typeof import('../src/index').callbackProp;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ mountIsland, connectIslandWorker, callbackProp } = await import('../src/index'));
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

describe('flush mode', () => {
  it('push auto-subscribes at mount — out-of-task commits flush with no setMode call', async () => {
    const el = host();
    const island = await mountIsland({ worker: renderWorker, el, app: 'ticker' });
    expect(island.mode).toBe('push');
    expect(el.textContent).toContain('tick');
    // 'ticker' commits its second node from a setTimeout — outside any task.
    // Before auto-subscribe this needed an explicit setMode('push') ritual.
    await vi.waitFor(() => expect(el.querySelector('.tocked')).not.toBeNull());
    island.destroy();
  });

  it('mode: poll builds a doorbell-free client — no SharedArrayBuffer needed', async () => {
    const client = connectIslandWorker({ worker: renderWorker, doorbell: false });
    expect(client.sharedMemory).toBeUndefined();

    const el = host();
    const island = await mountIsland({ client, el, app: 'ticker', mode: 'poll' });
    expect(island.mode).toBe('poll');
    expect(el.textContent).toContain('tick');
    // Poll interval drains the out-of-task commit too (50ms tick < waitFor).
    await vi.waitFor(() => expect(el.querySelector('.tocked')).not.toBeNull());
    island.destroy();
  });

  it('template.content appends route into the real element\'s content fragment', async () => {
    const el = host();
    const island = await mountIsland({ worker: renderWorker, el, app: 'tpl' });
    const tpl = el.querySelector('template') as HTMLTemplateElement;
    // The content.write op landed inside the template's content fragment —
    // the DOM-spec home for template children — not as a light-DOM child.
    expect(tpl.content.querySelector('span')?.textContent).toBe('inside template');
    expect(tpl.childNodes.length).toBe(0);
    // And cloning the content instantiated it into live DOM.
    expect(el.querySelector('.instantiated span')?.textContent).toBe('inside template');
    island.destroy();
  });

  it('callbackProp marshals a shell function into a worker-callable prop', async () => {
    const calls: string[] = [];
    const el = host();
    const island = await mountIsland({
      worker: renderWorker,
      el,
      app: 'cb',
      props: {
        onAction: callbackProp((v: string) => calls.push(v)),
        // Marker inside a nested object — marshalling recurses containers.
        deep: { later: callbackProp((v: string) => calls.push(v)) },
      },
    });
    // The cloneable preflight must see the marshalled wire shape, not the
    // function — mount succeeding at all proves that ordering.
    el.querySelector('button.call-me')!.dispatchEvent(
      new (realDoc.defaultView as typeof window).MouseEvent('click', { bubbles: true }),
    );
    // Worker handler invoked both callables → emit ops ride the dispatch
    // batch back → driver dispatches to the marshalled shell functions.
    await vi.waitFor(() => expect(calls).toEqual(['from worker', 'nested']));
    island.destroy();
  });
});

describe('mount handshake failures', () => {
  it('rejects when the worker entry never answers — mountTimeout', async () => {
    const hang = () => new Promise<unknown>(() => {});
    InProcessWorker.handlerModules.push(hang);
    try {
      await expect(
        mountIsland({ worker: renderWorker, el: host(), app: 'rcounter', mountTimeout: 50 }),
      ).rejects.toThrow(/never answered within 50ms/);
    } finally {
      InProcessWorker.handlerModules.splice(
        InProcessWorker.handlerModules.indexOf(hang),
        1,
      );
    }
  });

  it('rejects fast when the worker entry fails to load — error event, not a hang', async () => {
    const broken = () => Promise.reject(new Error('cannot resolve ./missing'));
    InProcessWorker.handlerModules.push(broken);
    try {
      await expect(
        mountIsland({ worker: renderWorker, el: host(), app: 'rcounter', mountTimeout: 30_000 }),
      ).rejects.toThrow(/failed to load/);
    } finally {
      InProcessWorker.handlerModules.splice(
        InProcessWorker.handlerModules.indexOf(broken),
        1,
      );
    }
  });
});
