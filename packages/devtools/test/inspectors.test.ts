// @vitest-environment happy-dom
/**
 * Smoke tests for the inspector panels (app/panels/inspect-island.js,
 * memory-values.js, reactivity.js) against a stub dashboard api: they
 * must call the documented commands with the documented arg shapes and
 * render from events without rebuilding on every render tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore: plain-JS dashboard module (no declarations; the app has no build step)
import * as islandPanel from '../app/panels/inspect-island.js';
// @ts-ignore: plain-JS dashboard module
import * as memoryPanel from '../app/panels/memory-values.js';
// @ts-ignore: plain-JS dashboard module
import * as reactivityPanel from '../app/panels/reactivity.js';

type Call = { sid: string; cmd: string; args: Record<string, unknown> };

const SID = 's1';

function stubApi(replies: Record<string, (args: any) => unknown>) {
  const calls: Call[] = [];
  const hooks = { event: [] as any[], render: [] as any[], reset: [] as any[], reconcile: [] as any[], inspectIsland: [] as any[] };
  const session = { id: SID, name: 'app', closed: false };
  const panels = document.createElement('div');
  panels.className = 'panels';
  document.body.appendChild(panels);
  const api = {
    hooks,
    palette: [] as any[],
    state: { sessions: new Map([[SID, session]]), sel: null },
    livePaused: false,
    onEvent: (fn: any) => hooks.event.push(fn),
    onRender: (fn: any) => hooks.render.push(fn),
    onReset: (fn: any) => hooks.reset.push(fn),
    onReconcile: (fn: any) => hooks.reconcile.push(fn),
    onInspectIsland: (fn: any) => hooks.inspectIsland.push(fn),
    addPaletteItem(item: any) { this.palette.push(item); },
    esc: (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!),
    key: (...p: string[]) => p.join('|'),
    sessOf: (k: string) => k.split('|')[0],
    inSel: () => true,
    hasCommand: () => true,
    selectedOrOnlyLive: () => SID,
    liveSessions: () => [session],
    scheduleRender: () => {},
    openSub: () => {},
    control: (sid: string, cmd: string, args: Record<string, unknown> = {}) => {
      calls.push({ sid, cmd, args });
      const r = replies[cmd];
      return r ? Promise.resolve(r(args)) : Promise.reject(new Error(`no stub for ${cmd}`));
    },
    addView({ id, html }: { id: string; html: string }) {
      const s = document.createElement('section');
      s.className = 'view';
      s.id = `view-${id}`;
      s.innerHTML = html;
      panels.appendChild(s);
      return s;
    },
    addSubview(viewId: string, { id, html }: { id: string; html: string }) {
      let view = document.getElementById(`view-${viewId}`);
      if (!view) view = this.addView({ id: viewId, html: '' });
      const d = document.createElement('div');
      d.className = 'subview';
      d.id = id;
      d.innerHTML = html;
      view.appendChild(d);
      return d;
    },
  };
  const ingest = (e: Record<string, unknown>) => {
    for (const h of hooks.event) h(session, { at: 0, thread: 'main', ...e });
  };
  const render = () => { for (const h of hooks.render) h(); };
  return { api, calls, ingest, render };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; });
afterEach(() => vi.useRealTimers());

describe('inspect-island panel', () => {
  const tree = {
    root: { id: '0', tag: 'div', attrs: [], children: [
      { id: '0.0', tag: 'button', attrs: [['class', 'go']], children: [{ id: '0.0.0', tag: '#text', attrs: [], text: 'Go', children: [] }] },
    ] },
    count: 3, truncated: false,
  };

  it('fetches island.tree once per key, highlights on hover, and shows props diffs + filtered events', async () => {
    const { api, calls, ingest } = stubApi({ 'island.tree': () => tree, 'island.highlight': () => ({ ok: true }) });
    islandPanel.setup(api);
    const extra = document.createElement('div');
    document.body.appendChild(extra);
    const inspect = () => api.hooks.inspectIsland.forEach((h: any) => h(`${SID}|counter@1`, {}, { extra, actions: null }));

    ingest({ type: 'island:props', instance: 'counter@1', props: '{"rows":3,"label":"a"}' });
    ingest({ type: 'island:props', instance: 'counter@1', props: '{"rows":4,"label":"a","x":1}' });
    ingest({ type: 'island:event', instance: 'counter@1', name: 'picked', payload: '{"id":7}' });
    ingest({ type: 'island:event', instance: 'counter@1', name: 'scrolled', payload: '{"y":2}' });

    inspect();
    inspect();
    await tick();
    expect(calls.filter((c) => c.cmd === 'island.tree')).toEqual([{ sid: SID, cmd: 'island.tree', args: { instance: 'counter@1', maxNodes: 4000 } }]);
    inspect();
    const rows = extra.querySelectorAll('.ii-row');
    expect(rows).toHaveLength(3);

    rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    extra.querySelector('.ii-tree')!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(calls.filter((c) => c.cmd === 'island.highlight').map((c) => c.args)).toEqual([
      { instance: 'counter@1', id: '0.0' },
      { instance: 'counter@1', id: null },
    ]);

    (rows[1] as HTMLElement).click();
    expect(extra.querySelector('.ii-detail')!.textContent).toContain('class');

    const props = extra.querySelector('[data-el=props]')!;
    expect(props.innerHTML).toContain('~ rows: 3 → 4');
    expect(props.innerHTML).toContain('+ x: 1');

    const filter = extra.querySelector<HTMLInputElement>('[data-el=filter]')!;
    filter.value = 'pick';
    filter.dispatchEvent(new Event('input'));
    const events = extra.querySelector('[data-el=events]')!;
    expect(events.textContent).toContain('picked');
    expect(events.textContent).not.toContain('scrolled');
    // Render ticks keep the filter input (no rebuild).
    inspect();
    expect(extra.querySelector<HTMLInputElement>('[data-el=filter]')!.value).toBe('pick');
  });

  it("nested islands read the top-level island's tree, with a note", async () => {
    const { api, calls } = stubApi({ 'island.tree': () => tree });
    islandPanel.setup(api);
    const extra = document.createElement('div');
    api.hooks.inspectIsland.forEach((h: any) => h(`${SID}|host@1~inner@2`, {}, { extra, actions: null }));
    await tick();
    expect(calls[0].args.instance).toBe('host@1');
    expect(extra.querySelector('.ii-msg')!.textContent).toMatch(/Nested island/);
  });
});

describe('memory-values panel', () => {
  it('polls memory.read while visible, flashes changes, diffs against a snapshot, and sets watches', async () => {
    vi.useFakeTimers();
    let n = 1;
    const { api, calls, ingest, render } = stubApi({
      'memory.read': () => [{ path: 'signals.count', value: String(n), version: n, contract: 0 }],
      'memory.watches': () => [],
      'memory.watch': (a) => [{ path: a.path, rule: a.rule, hits: 0 }],
    });
    memoryPanel.setup(api);
    const div = document.getElementById('mv-values')!;
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toHaveLength(0); // hidden: no polling

    div.classList.add('on');
    div.closest('.view')!.classList.add('on');
    await vi.advanceTimersByTimeAsync(600);
    const value = () => div.querySelector('#mvvTable tbody td.v')!;
    expect(value().textContent).toBe('1');

    div.querySelector<HTMLButtonElement>('#mvvSnap')!.click();
    n = 2;
    await vi.advanceTimersByTimeAsync(600);
    expect(value().textContent).toBe('2');
    expect(value().classList.contains('flash')).toBe(true);
    expect(div.querySelector('#mvvTable tbody td.d')!.textContent).toBe('was 1');

    div.querySelector<HTMLSelectElement>('#mvvPath')!.value = 'signals.count';
    div.querySelector<HTMLInputElement>('#mvvRule')!.value = '> 5';
    div.querySelector<HTMLButtonElement>('#mvvAdd')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.find((c) => c.cmd === 'memory.watch')!.args).toEqual({ path: 'signals.count', rule: '> 5' });
    expect(div.querySelector('#mvvWatches')!.textContent).toContain('> 5');

    ingest({ type: 'memory:watch-hit', path: 'signals.count', version: 9, value: '9', rule: '> 5' });
    render();
    expect(div.querySelector('#mvvHits')!.textContent).toContain('signals.count');
    expect(api.palette.map((p: any) => p.id)).toContain('memory.snapshot');
  });
});

describe('reactivity panel', () => {
  it('lanes nodes by thread, links deps across lanes, and fades disposed nodes', () => {
    const { api, ingest, render } = stubApi({});
    reactivityPanel.setup(api);
    const section = document.getElementById('view-reactivity')!;
    render();
    expect(section.querySelector('.rx-empty')).toBeNull(); // hidden view: nothing drawn yet
    section.classList.add('on');
    render();
    expect(section.querySelector('.rx-empty')).not.toBeNull();

    ingest({ type: 'reactive:node', id: 'mem:signals.count', kind: 'source', label: 'signals.count', owner: 'shared' });
    ingest({ type: 'reactive:node', id: 'b1', kind: 'bridge', label: 'waitAsync signals.count', deps: ['mem:signals.count'], owner: 'main' });
    ingest({ type: 'reactive:node', id: 'e2', kind: 'effect', label: 'observe(signals.count) · 1 sub', deps: ['b1'], owner: 'main' });
    ingest({ type: 'reactive:node', id: 'b1', kind: 'bridge', label: 'poll signals.count', deps: ['mem:signals.count'], owner: 'worker', thread: 'worker', worker: { poolId: 'pool-1', slot: 0 } });
    ingest({ type: 'reactive:node', id: 'e2', kind: 'effect', label: 'observe(signals.count) · 1 sub', deps: ['b1'], owner: 'main', disposed: true });
    render();

    const lanes = [...section.querySelectorAll('text.lane')].map((t) => t.textContent);
    expect(lanes).toEqual(['shared memory', 'main', 'pool-1#0']);
    expect(section.querySelectorAll('g.n')).toHaveLength(4);
    expect(section.querySelectorAll('path.e')).toHaveLength(3);
    expect(section.querySelectorAll('g.n.off')).toHaveLength(1);

    (section.querySelector('g.n[data-k="s1|main/b1"]') as SVGGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const detail = section.querySelector('#rxDetail')!.textContent!;
    expect(detail).toContain('main/b1');
    expect(detail).toContain('signals.count');
    expect(detail).toContain('observe(signals.count)');

    section.querySelector<HTMLInputElement>('#rxDisposed')!.click();
    expect(section.querySelectorAll('g.n')).toHaveLength(3);
  });
});
