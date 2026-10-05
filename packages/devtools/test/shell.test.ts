// @vitest-environment happy-dom
/**
 * The dashboard shell panel (app/panels/shell.js) against a minimal
 * stand-in for main.js: nav + views + subnavs and the api surface the
 * shell uses (hooks, openView/openSub, palette, intros, toolbar).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS panel module (no types)
import { setup } from '../app/panels/shell.js';

type Hook = (...a: unknown[]) => void;

const memStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
};

function mountFakeDashboard() {
  document.body.className = 'local';
  document.body.innerHTML = `
    <header><button id="sideToggle"></button><div id="toolbar"></div></header>
    <main><aside></aside><div class="panels">
      <nav>
        <button data-view="dashboard" class="on">Dashboard</button>
        <button data-view="tasks">Tasks</button>
        <button data-view="memory">Memory</button>
        <button data-view="log">Log</button>
      </nav>
      <section class="view on" id="view-dashboard">
        <nav class="subnav">
          <button class="on" data-sub="tv-dash">Overview</button>
          <button data-sub="tv-pools">Pools</button>
          <button data-sub="tv-island" id="navTopoI" style="display:none">Island</button>
        </nav>
        <div class="subview on" id="tv-dash"><table id="t1"><tr><td>x</td></tr></table></div>
        <div class="subview" id="tv-pools"></div>
        <div class="subview" id="tv-island"></div>
      </section>
      <section class="view" id="view-tasks"></section>
      <section class="view" id="view-memory">
        <nav class="subnav">
          <button class="on" data-sub="mv-fields">Shared-memory writes</button>
          <button data-sub="mv-heap">JS heap</button>
        </nav>
        <div class="subview on" id="mv-fields"></div><div class="subview" id="mv-heap"></div>
      </section>
      <section class="view" id="view-log"><input id="logq" type="search"></section>
    </div></main>`;

  const hooks: Record<string, Hook[]> = { render: [], tick: [], navigate: [], intro: [] };
  const state = {
    sessions: new Map<string, { id: string; name?: string; closed?: boolean }>(),
    islands: new Map<string, { app: string; ended?: boolean }>(),
    workers: new Map(),
    pools: new Map(),
    sel: null as string | null,
    inspect: null as string | null,
    inspectWorker: null as string | null,
  };
  const navigated = () => hooks.navigate.forEach((h) => h());
  const render = () => {
    // mimic renderInspector: the Island sub-tab shows once something is inspected
    (document.getElementById('navTopoI') as HTMLElement).style.display = state.inspect ? '' : 'none';
    hooks.render.forEach((h) => h());
  };
  const openView = (id: string) => {
    const btn = document.querySelector(`.panels > nav button[data-view="${id}"]`);
    if (!btn) return;
    document.querySelectorAll('.panels > nav button').forEach((x) => x.classList.toggle('on', x === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${id}`));
    render();
    navigated();
  };
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest?.('.subnav button[data-sub]') as HTMLElement | null;
    if (!b) return;
    const nav = b.closest('.subnav')!;
    nav.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    nav.parentElement!.querySelectorAll(':scope > .subview').forEach((v) => v.classList.toggle('on', v.id === b.dataset.sub));
    render();
    navigated();
  });
  document.querySelector('.panels > nav')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-view]') as HTMLElement | null;
    if (b) openView(b.dataset.view!);
  });
  const openSub = (view: string, sub: string) => {
    if (!document.getElementById(`view-${view}`)) return;
    if (!document.getElementById(`view-${view}`)!.classList.contains('on')) openView(view);
    render();
    const btn = document.querySelector(`#view-${view} .subnav button[data-sub="${sub}"]`) as HTMLElement | null;
    if (btn && btn.style.display !== 'none') btn.click();
  };
  const api = {
    hooks, state,
    esc: (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)),
    isMini: false, transport: 'broadcast',
    palette: [] as { id: string }[],
    addPaletteItem(item: { id: string }) {
      const i = this.palette.findIndex((p) => p.id === item.id);
      if (i >= 0) this.palette[i] = item; else this.palette.push(item);
    },
    onRender: (fn: Hook) => hooks.render.push(fn),
    onTick: (fn: Hook) => hooks.tick.push(fn),
    onNavigate: (fn: Hook) => hooks.navigate.push(fn),
    viewIntros: new Map<string, string>(),
    setViewIntro(id: string, html: string) { this.viewIntros.set(id, html); hooks.intro.forEach((h) => h(id, html)); },
    addToolbarButton: ({ id, label, title, onClick }: { id: string; label: string; title?: string; onClick: () => void }) => {
      const b = document.createElement('button');
      b.id = id; b.innerHTML = label; if (title) b.title = title; b.onclick = onClick;
      document.getElementById('toolbar')!.append(b);
      return b;
    },
    openView, openSub, render, scheduleRender: render,
    toast: vi.fn(),
  };
  return api;
}

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
const flush = () => new Promise((r) => setTimeout(r, 0));
const activeView = () => document.querySelector('.panels > nav button.on')?.getAttribute('data-view');
const palette = () => document.querySelector('[aria-label="Command palette"]')!.parentElement as HTMLElement;

// Each setup() adds window/document listeners; drop them between tests so
// a previous test's shell can't act on the next test's DOM.
const added: [EventTarget, string, EventListenerOrEventListenerObject][] = [];
const track = (t: EventTarget) => {
  const orig = t.addEventListener.bind(t);
  vi.spyOn(t, 'addEventListener').mockImplementation((type, fn, opts) => {
    if (fn) added.push([t, type, fn]);
    orig(type, fn, opts);
  });
};

describe('dashboard shell', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memStorage());
    history.replaceState(null, '', location.pathname);
    track(window);
    track(document);
  });
  afterEach(() => {
    for (const [t, type, fn] of added.splice(0)) t.removeEventListener(type, fn);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('opens the palette on Ctrl+K and runs a fuzzy-matched view', async () => {
    const api = mountFakeDashboard();
    setup(api);
    press('k', { ctrlKey: true });
    expect(palette().hidden).toBe(false);
    const input = palette().querySelector('input')!;
    input.value = 'heap';
    input.dispatchEvent(new Event('input'));
    const first = palette().querySelector('.sh-item.on')!;
    expect(first.textContent).toContain('Memory › JS heap');
    press('Enter', {}, input);
    expect(palette().hidden).toBe(true);
    expect(activeView()).toBe('memory');
    expect(document.querySelector('#view-memory .subnav button.on')!.getAttribute('data-sub')).toBe('mv-heap');
    await flush();
    expect(location.hash).toBe('#/memory/mv-heap');
  });

  it('lists islands from state and opens their inspector', () => {
    const api = mountFakeDashboard();
    setup(api);
    api.state.sessions.set('s1', { id: 's1' });
    api.state.islands.set('s1|chart@1', { app: 'chart' });
    press('k', { metaKey: true });
    const input = palette().querySelector('input')!;
    input.value = 'chart';
    input.dispatchEvent(new Event('input'));
    press('Enter', {}, input);
    expect(api.state.inspect).toBe('s1|chart@1');
    expect(document.querySelector('#view-dashboard .subnav button.on')!.getAttribute('data-sub')).toBe('tv-island');
  });

  it('g <letter> switches views, ignoring keys typed into inputs', () => {
    const api = mountFakeDashboard();
    setup(api);
    press('g'); press('t');
    expect(activeView()).toBe('tasks');
    press('g'); press('p'); // no performance view: nothing happens
    expect(activeView()).toBe('tasks');
    const q = document.getElementById('logq')!;
    press('g', {}, q); press('d', {}, q);
    expect(activeView()).toBe('tasks');
    press('g'); press('l');
    press('/');
    expect(document.activeElement).toBe(q);
  });

  it('? opens help listing views with intros; Esc closes it', () => {
    const api = mountFakeDashboard();
    setup(api);
    press('?');
    const help = document.querySelector('[aria-labelledby="sh-help-t"]')!;
    expect(help.parentElement!.hidden).toBe(false);
    expect(help.textContent).toContain('Shared-memory writes need a defineSharedMemory contract');
    press('Escape');
    expect(help.parentElement!.hidden).toBe(true);
  });

  it('restores a deep link once the routed island arrives', async () => {
    history.replaceState(null, '', '#/dashboard/tv-island?island=old|chart@1');
    const api = mountFakeDashboard();
    setup(api);
    expect(api.state.inspect).toBeNull();
    // the app reloaded: same instance, new session id
    api.state.sessions.set('new', { id: 'new' });
    api.state.islands.set('new|chart@1', { app: 'chart' });
    api.render();
    expect(api.state.inspect).toBe('new|chart@1');
    expect(document.querySelector('#view-dashboard .subnav button.on')!.getAttribute('data-sub')).toBe('tv-island');
    await flush();
    expect(location.hash).toBe('#/dashboard/tv-island?island=new|chart@1');
  });

  it('remembers the last view per context when there is no hash', async () => {
    const a = mountFakeDashboard();
    setup(a);
    a.openView('log');
    await flush();
    history.replaceState(null, '', location.pathname);
    const b = mountFakeDashboard();
    setup(b);
    expect(activeView()).toBe('log');
  });

  it('renders dismissible intros, persists dismissal, accepts panel intros', () => {
    const api = mountFakeDashboard();
    setup(api);
    const intro = document.querySelector('#view-tasks > .sh-intro')!;
    expect(intro.textContent).toContain('connectWorker');
    (intro.querySelector('button') as HTMLButtonElement).click();
    expect(document.querySelector('#view-tasks > .sh-intro')).toBeNull();
    api.setViewIntro('log', 'Custom <b>intro</b>');
    expect(document.querySelector('#view-log > .sh-intro')!.innerHTML).toContain('<b>intro</b>');
    // a fresh load keeps the dismissal
    const again = mountFakeDashboard();
    setup(again);
    expect(document.querySelector('#view-tasks > .sh-intro')).toBeNull();
  });

  it('DevTools extension panel (body.ext): Shift chord for the palette, no copy-link', () => {
    const api = mountFakeDashboard();
    document.body.classList.add('ext');
    setup(api);
    expect(document.getElementById('sh-palette')!.title).toMatch(/\+Shift\+K\)$/);
    press('K', { ctrlKey: true, shiftKey: true });
    expect(palette().hidden).toBe(false);
    const input = palette().querySelector('input')!;
    input.value = 'copy link';
    input.dispatchEvent(new Event('input'));
    expect(palette().textContent).not.toContain('Copy link to this view');
  });

  it('outside the extension, Ctrl+Shift+K is left alone', () => {
    const api = mountFakeDashboard();
    setup(api);
    press('K', { ctrlKey: true, shiftKey: true });
    expect(palette().hidden).toBe(true);
  });

  it('wraps tables in a horizontal scroller', () => {
    const api = mountFakeDashboard();
    setup(api);
    expect(document.getElementById('t1')!.parentElement!.classList.contains('sh-tscroll')).toBe(true);
  });
});
