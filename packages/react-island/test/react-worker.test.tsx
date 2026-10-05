// @vitest-environment happy-dom
/**
 * `reactIslandApp` / `defineReactPolyWorker` / `defineReactMonoWorker` —
 * React components rendered inside the island worker by the react-reconciler
 * host config (`src/hostConfig.ts`). In-process E2E like the sibling suites:
 * real registry + op protocol, the only fake being the thread boundary
 * (InProcessWorker runs the worker entries in this module graph).
 *
 * The mounts below walk the reconciler's host surface: create/text/append/
 * insertBefore/remove ops, commitUpdate/commitTextUpdate, the namespace
 * host context (<svg>/<math>/<foreignObject>), Suspense hide/unhide,
 * createPortal into adopted proxy elements, detachDeletedInstance, and the
 * imperative-entry branch of defineReactPolyWorker.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mountIsland, connectIslandWorker } from '@atolljs/islands';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { setDevtoolsSink, type DevtoolsEvent } from '@atolljs/core';
import { suspendControl } from './fixtures/react.worker';
import { taggedApp } from './fixtures/react-mono.worker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/react.worker'),
  () => import('./fixtures/react-mono.worker'),
];

const reactWorker = () =>
  new Worker(new URL('./fixtures/react.worker.tsx', import.meta.url), { type: 'module' });
const monoWorker = () =>
  new Worker(new URL('./fixtures/react-mono.worker.tsx', import.meta.url), { type: 'module' });

// In-process artifact: once an island mounts, ambient globalThis.document can
// resolve to the PROXY document — capture the real one for assertions.
let realDoc: Document;
beforeAll(() => {
  realDoc = document;
});

function host(): HTMLElement {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
}

const click = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('reactIslandApp — mounted components', () => {
  it('mounts a stateful component, round-trips a dispatch, patches props in place', async () => {
    const el = host();
    const emitted: Array<{ name: string; payload: unknown }> = [];
    const island = await mountIsland({
      worker: reactWorker,
      el,
      app: 'counter',
      props: { label: 'ticks' },
      onEvent: (name, payload) => emitted.push({ name, payload }),
    });

    // Reconciler mount → create/text/append ops replayed to real DOM.
    await vi.waitFor(() => expect(el.querySelector('.btn')?.textContent).toBe('ticks: 0'));
    const btn = el.querySelector('.btn')!;

    // Click → dispatch task → the handler's setState commits inside the
    // sync lane → commitTextUpdate lands in the return batch.
    click(btn);
    await vi.waitFor(() => expect(el.querySelector('.btn')?.textContent).toBe('ticks: 1'));
    expect(emitted.some((e) => e.name === 'ticked')).toBe(true);
    expect((emitted.find((e) => e.name === 'ticked')?.payload as { n: number }).n).toBe(1);

    // updateProps → handle.update → reconciler diff → the SAME button gets
    // a utext/update op, not a rebuild.
    await island.updateProps({ label: 'renamed' });
    await vi.waitFor(() =>
      expect(el.querySelector('.btn')?.textContent).toBe('renamed: 1'),
    );
    expect(el.querySelector('.btn')).toBe(btn);

    // destroy → the island tears down; as the client's only mount its
    // worker terminates (teardown ops are dropped driver-side — termination
    // is the honest signal).
    const worker = InProcessWorker.created.at(-1)!;
    island.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });

  it('reorders keyed children with insertBefore and removes with removeChild', async () => {
    const el = host();
    const island = await mountIsland({
      worker: reactWorker,
      el,
      app: 'list',
      props: { items: 'a,b,c', extra: true },
    });

    await vi.waitFor(() => expect(el.querySelectorAll('.row')).toHaveLength(3));
    expect(el.querySelector('.extra')?.textContent).toBe('extra');
    const rows = () => [...el.querySelectorAll('.row')].map((r) => r.getAttribute('data-k'));
    expect(rows()).toEqual(['a', 'b', 'c']);

    // Prepend: a new keyed row inserted BEFORE an existing sibling under an
    // element parent → hostConfig.insertBefore (not appendChild).
    await island.updateProps({ items: 'z,a,b,c', extra: true });
    await vi.waitFor(() => expect(rows()).toEqual(['z', 'a', 'b', 'c']));

    // Reorder + drop rows: keyed moves emit insertBefore; the dropped
    // rows emit removeChild (and detachDeletedInstance frees listeners).
    const rowB = el.querySelector('[data-k="b"]')!;
    await island.updateProps({ items: 'c,b' });
    await vi.waitFor(() => expect(rows()).toEqual(['c', 'b']));
    expect(el.querySelectorAll('.row')[1]).toBe(rowB); // moved, not recreated

    // Removing a ROOT-level child goes through removeChildFromContainer.
    await island.updateProps({ items: 'c,b', extra: false });
    await vi.waitFor(() => expect(el.querySelector('.extra')).toBeNull());
    await island.updateProps({ items: 'c,b', extra: true });
    await vi.waitFor(() => expect(el.querySelector('.extra')?.textContent).toBe('extra'));

    island.destroy();
  });

  it('renders svg/math trees through the namespace host context', async () => {
    const el = host();
    const island = await mountIsland({ worker: reactWorker, el, app: 'svgapp' });

    await vi.waitFor(() => expect(el.querySelector('svg.chart')).not.toBeNull());
    // The ns flag on create ops must produce real namespaced elements —
    // a missing namespace surfaces as HTMLUnknownElement-ish HTML nodes.
    expect(el.querySelector('svg.chart')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(el.querySelector('circle.dot')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(el.querySelector('math')!.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
    // foreignObject is an HTML integration point — its children are HTML.
    // (The element itself: React DOM keeps it in the SVG namespace; this
    // host config's childHostContextFor flips the ELEMENT to HTML — a
    // suspected deviation reported separately, not asserted here.)
    const fo = el.querySelector('foreignObject.fo')!;
    expect(fo.querySelector('.fo-text')!.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(fo.querySelector('.fo-text')!.textContent).toBe('html in svg');

    island.destroy();
  });

  it('Suspense: an update that suspends hides content, resolving unhides it', async () => {
    const el = host();
    const island = await mountIsland({
      worker: reactWorker,
      el,
      app: 'susp',
      props: { suspend: false },
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.real')?.textContent).toContain('real content'),
    );

    // The bare text child directly under the boundary renders too.
    expect(el.textContent).toContain('stray text');

    // Suspend on update — the boundary hides its content (hideInstance on
    // the element, hideTextInstance on the bare text sibling) and commits
    // the fallback.
    await island.updateProps({ suspend: true });
    await vi.waitFor(() => {
      expect(el.querySelector('.fb')?.textContent).toBe('loading');
      expect(
        (el.querySelector('.real') as HTMLElement | null)?.hasAttribute('hidden'),
      ).toBe(true);
    });
    // hideTextInstance emptied the stray text node.
    expect(el.textContent).not.toContain('stray text');

    // Release the gate, then re-render with suspend off — the update
    // unhides (unhideInstance/unhideTextInstance) and removes the fallback.
    suspendControl.release();
    await island.updateProps({ suspend: false });
    await vi.waitFor(() => {
      const realEl = el.querySelector('.real') as HTMLElement | null;
      expect(realEl?.textContent).toContain('real content');
      expect(realEl?.hasAttribute('hidden')).toBe(false);
      expect(el.textContent).toContain('stray text');
    });
    await vi.waitFor(() => expect(el.querySelector('.fb')).toBeNull());
    island.destroy();
  });

  it('createPortal beams children into ref-captured proxy elements (html + svg)', async () => {
    const el = host();
    const island = await mountIsland({
      worker: reactWorker,
      el,
      app: 'portal',
      props: { order: 'ab' },
    });

    // The ref callback's setTarget commits a second render — the portal
    // children land through the ProxyElement container path.
    await vi.waitFor(() => {
      expect(el.querySelectorAll('.portal-target .beamed')).toHaveLength(2);
      expect(el.querySelector('.svg-target circle.svg-beamed')).not.toBeNull();
    });
    // The svg portal rendered through getRootHostContext's ns lookup stays SVG.
    expect(el.querySelector('.svg-target circle.svg-beamed')!.namespaceURI).toBe(
      'http://www.w3.org/2000/svg',
    );

    // Reorder the portal's children → insertInContainerBefore ops.
    await island.updateProps({ order: 'ba' });
    await vi.waitFor(() =>
      expect(
        [...el.querySelectorAll('.portal-target .beamed')].map((n) => n.textContent),
      ).toEqual(['b', 'a']),
    );
    island.destroy();
  });

  it('fragment roots: container-level insertBefore and the Fragment-ref stub surface', async () => {
    const el = host();
    const island = await mountIsland({
      worker: reactWorker,
      el,
      app: 'frag',
      props: { lead: false },
    });
    await vi.waitFor(() => expect(el.querySelector('.ftail')?.textContent).toBe('tail'));
    expect(el.querySelector('.lead')).toBeNull();

    // Inserting a child BEFORE an existing root-level sibling goes through
    // insertInContainerBefore (the container parent path).
    await island.updateProps({ lead: true });
    await vi.waitFor(() => {
      const kids = [...el.children];
      expect(kids[0]?.className).toBe('lead');
      expect(kids[1]?.className).toBe('ftail');
    });

    // Removing it again → removeChildFromContainer.
    await island.updateProps({ lead: false });
    await vi.waitFor(() => expect(el.querySelector('.lead')).toBeNull());
    island.destroy();
  });

  it('a React render throw unmounts the tree (React swallows it — no task rejection)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const el = host();
      const island = await mountIsland({
        worker: reactWorker,
        el,
        app: 'boomtree',
        props: { boom: false },
      });
      await vi.waitFor(() =>
        expect(el.querySelector('.tree-ok')?.textContent).toBe('fine'),
      );

      // No error boundary → the reconciler reports the error through
      // onUncaughtError (console.error via bindToConsole in dev) and
      // unmounts the root — the task itself RESOLVES.
      await island.updateProps({ boom: true });
      await vi.waitFor(() => {
        expect(el.querySelector('.tree-ok')).toBeNull();
        expect(
          spy.mock.calls.some((c) => c.some((a) => String(a).includes('render exploded'))),
        ).toBe(true);
      });
      island.destroy();
    } finally {
      spy.mockRestore();
    }
  });

  it('mounts an imperative app registered beside the React components', async () => {
    const el = host();
    const island = await mountIsland({
      worker: reactWorker,
      el,
      app: 'boom',
      props: { text: 'plain imperative' },
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.boom-ok')?.textContent).toBe('plain imperative'),
    );
    island.destroy();
  });
});

describe('worker entry variants', () => {
  it('defineReactMonoWorker mounts a bare component namelessly', async () => {
    const el = host();
    // No `app` — the instance worker resolves its single registered app.
    const island = await mountIsland({ worker: monoWorker, el, props: { label: 'one' } });
    await vi.waitFor(() =>
      expect(el.querySelector('.mono-react')?.textContent).toBe('mono: one'),
    );
    island.destroy();
  });

  it('defineReactMonoWorker accepts an imperative app', async () => {
    const el = host();
    const emitted: string[] = [];
    const island = await mountIsland({
      worker: monoWorker,
      el,
      app: 'monoImp',
      props: { label: 'imp' },
      onEvent: (name) => emitted.push(name),
    });
    await vi.waitFor(() => expect(el.querySelector('.mono-imp')?.textContent).toBe('imp'));
    click(el.querySelector('.imp-ping')!);
    await vi.waitFor(() => expect(emitted).toContain('imp-pinged'));
    island.destroy();
  });

  it('a reactIsland-stamped app mounts by reference through the poly registry', async () => {
    const el = host();
    const island = await mountIsland({
      worker: monoWorker,
      el,
      app: 'reactTagged',
      props: { label: 'stamped' },
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.tagged')?.textContent).toBe('tagged: stamped'),
    );
    expect(taggedApp.islandAppName).toBe('reactTagged');
    island.destroy();
  });

  it('a remount of the same instance key clears and rebuilds the React tree', async () => {
    const client = connectIslandWorker({ worker: reactWorker });
    await client.mount('counter@shared', { label: 'first' });
    const pid = await client.whoami('counter@shared');
    const ops = await client.mount('counter@shared', { label: 'second' });
    // Remount: same pid, the batch leads with a clear op before the rebuild.
    expect(await client.whoami('counter@shared')).toBe(pid);
    expect(ops.some((o) => o.t === 'clear')).toBe(true);
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    client.terminate();
  });

  it('updateProps on an unmounted instance rejects; dead handlers no-op', async () => {
    const client = connectIslandWorker({ worker: reactWorker });
    await expect(client.updateProps('ghost@1', {})).rejects.toThrow(/not mounted/);
    expect(await client.dispatch(999_999, { type: 'click' })).toEqual([]);
    client.terminate();
  });
});

describe('renderer reporting', () => {
  it('React apps report "react"; imperative entries and unknown instances report null', async () => {
    const client = connectIslandWorker({ worker: reactWorker });
    await client.mount('counter@r1', { label: 'x' });
    await client.mount('boom@r2', {});
    expect(await client.renderer('counter@r1')).toBe('react');
    expect(await client.renderer('boom@r2')).toBeNull();
    expect(await client.renderer('ghost@1')).toBeNull();
    client.terminate();
  });

  it('island:mount carries the reported renderer unless the mount declared one', async () => {
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((e) => events.push(e));
    try {
      const a = await mountIsland({ worker: reactWorker, el: host(), app: 'counter', props: { label: 'a' } });
      const b = await mountIsland({
        worker: reactWorker, el: host(), app: 'counter', props: { label: 'b' }, framework: 'custom',
      });
      const c = await mountIsland({ worker: reactWorker, el: host(), app: 'boom', props: {} });
      const mounts = events.filter((e) => e.type === 'island:mount') as Array<{ framework?: string }>;
      expect(mounts.map((m) => m.framework)).toEqual(['react', 'custom', undefined]);
      a.destroy();
      b.destroy();
      c.destroy();
    } finally {
      setDevtoolsSink(null);
    }
  });
});
