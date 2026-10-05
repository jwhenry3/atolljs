// @vitest-environment happy-dom
/**
 * Devtools surface of the island drivers: `island:props` / `island:event`
 * payload / `island:ops` bytes events, the replay User Timing measure, and
 * the `island.*` dashboard commands (list, tree, highlight, props,
 * updateProps, setMode), including nested-island DOM in the outer tree.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import {
  listDevtoolsCommands,
  runDevtoolsCommand,
  setDevtoolsSink,
  type EmittedDevtoolsEvent,
} from '@atolljs/core';
import type { IslandHandle } from '../src/index';
import type { IslandTreeNode } from '../src/devtoolsCommands';
import { hostRef } from './fixtures/subOuter.worker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/perf.worker'),
  () => import('./fixtures/subOuter.worker'),
  () => import('./fixtures/subInner.worker'),
];

let mountIsland: typeof import('../src/index').mountIsland;
let callbackProp: typeof import('../src/index').callbackProp;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ mountIsland, callbackProp } = await import('../src/index'));
  await import('../src/worker/index');
});

const perfWorker = () =>
  new Worker(new URL('./fixtures/perf.worker.ts', import.meta.url), { type: 'module' });
const outerWorker = () =>
  new Worker(new URL('./fixtures/subOuter.worker.ts', import.meta.url), { type: 'module' });
const innerWorker = () =>
  new Worker(new URL('./fixtures/subInner.worker.ts', import.meta.url), { type: 'module' });

function host(): HTMLElement {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
}

let events: EmittedDevtoolsEvent[] = [];
const ofType = <T extends EmittedDevtoolsEvent['type']>(t: T) =>
  events.filter((e) => e.type === t) as Extract<EmittedDevtoolsEvent, { type: T }>[];
const on = () => {
  events = [];
  setDevtoolsSink((e) => events.push(e));
};
const click = (el: Element) =>
  el.dispatchEvent(new (realDoc.defaultView as typeof window).MouseEvent('click', { bubbles: true }));

const find = (n: IslandTreeNode, pred: (n: IslandTreeNode) => boolean): IslandTreeNode | undefined => {
  if (pred(n)) return n;
  for (const c of n.children) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return undefined;
};

afterEach(() => setDevtoolsSink(null));

describe('island devtools (off)', () => {
  it('registers no island commands and emits nothing while devtools is off', async () => {
    const el = host();
    const island = await mountIsland({ worker: perfWorker, el, app: 'tree', props: { rows: 1 } });
    expect(listDevtoolsCommands()).not.toContain('island.tree');
    island.destroy();
  });
});

describe('island devtools events', () => {
  it('emits island:props on mount/updateProps (callbacks as [fn]), payloads, op bytes, and replay measures', async () => {
    on();
    const measure = vi.spyOn(performance, 'measure');
    const el = host();
    const island = await mountIsland({
      worker: perfWorker, el, app: 'tree',
      props: { rows: 3, label: 'r', onPick: callbackProp(() => {}) },
    });

    const mountProps = ofType('island:props').filter((e) => e.instance === island.instance);
    expect(mountProps).toHaveLength(1);
    expect(JSON.parse(mountProps[0].props)).toEqual({ rows: 3, label: 'r', onPick: '[fn]' });
    // island:props follows island:mount so the dashboard already knows the island.
    const types = events.map((e) => e.type);
    expect(types.indexOf('island:props')).toBeGreaterThan(types.indexOf('island:mount'));

    const ops = ofType('island:ops').filter((e) => e.instance === island.instance);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops[0].bytes).toBeGreaterThan(0);
    expect(measure.mock.calls.some(([name]) => name === `atoll replay ${island.instance}`)).toBe(true);
    const opts = measure.mock.calls.find(([name]) => name === `atoll replay ${island.instance}`)![1] as {
      detail: { devtools: { trackGroup: string; track: string; dataType: string } };
    };
    expect(opts.detail.devtools).toMatchObject({ dataType: 'track-entry', trackGroup: 'atoll', track: 'islands' });

    click(el.querySelectorAll('button.bump')[1]);
    await vi.waitFor(() => expect(ofType('island:event')).toHaveLength(1));
    expect(ofType('island:event')[0]).toMatchObject({ instance: island.instance, name: 'bumped', payload: '{"i":1}' });

    await island.updateProps({ rows: 2, label: 'q' });
    const last = ofType('island:props').at(-1)!;
    expect(JSON.parse(last.props)).toEqual({ rows: 2, label: 'q' });
    island.destroy();
    measure.mockRestore();
  });
});

describe('island.* commands', () => {
  it('lists, serializes the tree, highlights, reads props, and switches mode', async () => {
    on();
    const el = host();
    const island = await mountIsland({ worker: perfWorker, el, app: 'tree', props: { rows: 3, label: 'r' } });
    const instance = island.instance;

    const list = (await runDevtoolsCommand('island.list')) as { instance: string; app: string; pid: string; mode: string }[];
    expect(list).toContainEqual({ instance, app: 'tree', pid: island.pid, mode: 'push' });

    const tree = (await runDevtoolsCommand('island.tree', { instance })) as {
      root: IslandTreeNode; count: number; truncated: boolean;
    };
    expect(tree.root.id).toBe('0');
    expect(tree.truncated).toBe(false);
    const rows = find(tree.root, (n) => n.attrs.some(([k, v]) => k === 'class' && v === 'tree'))!;
    expect(rows.children).toHaveLength(3);
    expect(rows.children[1].attrs).toContainEqual(['data-index', '1']);
    const text = find(tree.root, (n) => n.tag === '#text' && n.text === 'r 2');
    expect(text).toBeDefined();
    // The JSON transport must survive the result.
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);

    const capped = (await runDevtoolsCommand('island.tree', { instance, maxNodes: 4 })) as { count: number; truncated: boolean };
    expect(capped.count).toBe(4);
    expect(capped.truncated).toBe(true);

    const hl = (await runDevtoolsCommand('island.highlight', { instance, id: rows.children[0].id })) as { ok: boolean };
    expect(hl.ok).toBe(true);
    const overlay = realDoc.querySelector<HTMLElement>('[data-atoll-devtools="highlight"]')!;
    expect(overlay).not.toBeNull();
    expect(overlay.style.display).toBe('block');
    expect(overlay.style.pointerEvents).toBe('none');
    expect(overlay.textContent).toMatch(/^div \d+×\d+$/);
    expect(el.contains(overlay)).toBe(false);
    await runDevtoolsCommand('island.highlight', { instance, id: null });
    expect(overlay.style.display).toBe('none');
    expect(await runDevtoolsCommand('island.highlight', { instance, id: '0.99' })).toEqual({ ok: false });

    expect(await runDevtoolsCommand('island.props', { instance })).toEqual({
      props: { rows: 3, label: 'r' },
      preview: '{"rows":3,"label":"r"}',
    });

    await runDevtoolsCommand('island.updateProps', { instance, props: { rows: 1, label: 'z' } });
    expect(el.querySelectorAll('.row')).toHaveLength(1);
    expect(el.querySelector('.cell')!.textContent).toBe('z 0');
    expect(ofType('island:props').at(-1)!.props).toBe('{"rows":1,"label":"z"}');

    expect(await runDevtoolsCommand('island.setMode', { instance, mode: 'poll' })).toEqual({ mode: 'poll' });
    expect(island.mode).toBe('poll');
    await expect(runDevtoolsCommand('island.setMode', { instance, mode: 'warp' })).rejects.toThrow(/push.*poll/);

    island.destroy();
    const after = (await runDevtoolsCommand('island.list')) as { instance: string }[];
    expect(after.map((i) => i.instance)).not.toContain(instance);
    await expect(runDevtoolsCommand('island.tree', { instance })).rejects.toThrow(/not mounted/);
  });

  it('updateProps restores [fn] placeholders to the live callbacks', async () => {
    on();
    const el = host();
    const calls: string[] = [];
    const island = await mountIsland({
      worker: perfWorker, el, app: 'cb',
      props: { onAction: callbackProp((v: string) => calls.push(`a:${v}`)), tag: 1 },
    });
    const read = (await runDevtoolsCommand('island.props', { instance: island.instance })) as { props: Record<string, unknown> };
    expect(read.props).toEqual({ onAction: '[fn]', tag: 1 });

    // Read → edit → write round trip, the way the dashboard does it.
    await runDevtoolsCommand('island.updateProps', { instance: island.instance, props: { ...read.props, tag: 2 } });
    click(el.querySelector('.call-me')!);
    await vi.waitFor(() => expect(calls).toEqual(['a:from worker']));
    island.destroy();
  });

  it("includes a nested island's replayed DOM in the outer tree; the nested instance itself isn't commandable", async () => {
    on();
    const el = host();
    const outer = await mountIsland({ worker: outerWorker, el, app: 'subouter' });
    const sub = await mountIsland({ el: hostRef.el!, worker: innerWorker, app: 'inner', props: { label: 'nest' } });
    await outer.flush();

    const tree = (await runDevtoolsCommand('island.tree', { instance: outer.instance })) as { root: IslandTreeNode };
    const inner = find(tree.root, (n) => n.attrs.some(([k, v]) => k === 'class' && v === 'inner'));
    expect(inner).toBeDefined();
    // Sub-island events/props still stream (worker-side driver).
    expect(ofType('island:props').some((e) => e.instance === sub.instance)).toBe(true);

    await expect(runDevtoolsCommand('island.props', { instance: sub.instance })).rejects.toThrow(/nested/);
    const list = (await runDevtoolsCommand('island.list')) as { instance: string }[];
    expect(list.map((i) => i.instance)).not.toContain(sub.instance);
    outer.destroy();
    sub.destroy();
  });
});
