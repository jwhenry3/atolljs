// @vitest-environment happy-dom
/**
 * Host-op surface coverage for the Vue worker renderer — patchEvent's
 * invoker table (binding swaps, array handlers, modifier rebindings,
 * colon events), patchStyle's shapes, normalizeClass forms, form-property
 * reflection, namespaces, scope ids, keyed-list moves, and the retained
 * static vnode's insertStaticContent move path. All through the real op
 * protocol via `surface.worker.ts` (defineVuePolyWorker) and
 * `mono.worker.ts` (defineVueMonoWorker + the vueIsland stamp).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { callbackProp, connectIslandWorker, mountIsland } from '@atolljs/islands';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/surface.worker'),
  () => import('./fixtures/mono.worker'),
];

// In-process artifact: capture the real document before a instance's proxy
// document can claim the ambient global.
let realDoc: Document;
beforeAll(() => {
  realDoc = document;
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/surface.worker.ts', import.meta.url), { type: 'module' });

const mount = async (
  app: string,
  props: Record<string, unknown> = {},
  onEvent?: (n: string, p: unknown) => void,
) => {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  const client = connectIslandWorker({ worker: renderWorker });
  const island = await mountIsland({ client, el, app, props, onEvent });
  return { el, island };
};

const names = (emitted: Array<{ name: string }>) => emitted.map((e) => e.name);

describe('vueIslandApp — event invokers', () => {
  it('swaps handlers on the same binding, then detaches on removal', async () => {
    const calls: string[] = [];
    const { el, island } = await mount('events', {
      hit: callbackProp(() => calls.push('first')),
    });
    const btn = el.querySelector('.ev-btn') as HTMLElement;
    const ME = (realDoc.defaultView as typeof window).MouseEvent;

    btn.dispatchEvent(new ME('click', { bubbles: true }));
    await vi.waitFor(() => expect(calls).toEqual(['first']));

    // Same rawKey 'onClick', new callable → invoker.value swaps, no
    // remove/add round trip.
    await island.updateProps({ hit: callbackProp(() => calls.push('second')) });
    btn.dispatchEvent(new ME('click', { bubbles: true }));
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']));

    // Dropping the prop → the null patch removes the listener outright —
    // the click stops dispatching.
    await island.updateProps({});
    btn.dispatchEvent(new ME('click', { bubbles: true }));
    await island.flush();
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']));

    island.destroy();
  });

  it('array handlers all fire through one invoker', async () => {
    const calls: string[] = [];
    const emitted: Array<{ name: string }> = [];
    const { el, island } = await mount(
      'events',
      { hit: callbackProp(() => calls.push('cb')), multi: true },
      (name) => emitted.push({ name }),
    );
    const btn = el.querySelector('.ev-btn') as HTMLElement;
    btn.dispatchEvent(new (realDoc.defaultView as typeof window).MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => {
      expect(calls).toEqual(['cb']);
      expect(names(emitted)).toContain('multi-extra');
    });
    island.destroy();
  });

  it('a modifier binding claims the event name — the stale listener detaches', async () => {
    const calls: string[] = [];
    const emitted: Array<{ name: string }> = [];
    const { el, island } = await mount(
      'events',
      { hit: callbackProp(() => calls.push('hit')) },
      (name) => emitted.push({ name }),
    );
    const btn = el.querySelector('.ev-btn') as HTMLElement;
    const ME = (realDoc.defaultView as typeof window).MouseEvent;

    // onClick → onClickOnce: different listener slot claim — the plain
    // invoker is detached; the once invoker fires exactly once.
    await island.updateProps({ hit: callbackProp(() => calls.push('hit')), mode: 'once' });
    btn.dispatchEvent(new ME('click', { bubbles: true }));
    await vi.waitFor(() => expect(names(emitted)).toContain('once-fired'));
    expect(calls).toEqual([]); // the stale 'hit' listener is gone

    btn.dispatchEvent(new ME('click', { bubbles: true }));
    await island.flush();
    await vi.waitFor(() => {
      expect(names(emitted).filter((n) => n === 'once-fired')).toHaveLength(1);
      expect(calls).toEqual([]);
    });

    // Back to plain: onClickOnce's removal patch can't remove the NEW
    // 'onClick' invoker — the rawKey ownership guard keeps it.
    await island.updateProps({ hit: callbackProp(() => calls.push('hit')), mode: 'plain' });
    btn.dispatchEvent(new ME('click', { bubbles: true }));
    await vi.waitFor(() => expect(calls).toEqual(['hit']));

    // Capture modifier → its own (name|capture) listener slot — the plain
    // 'onClick' binding survives (different slot), so 'hit' fires too.
    await island.updateProps({
      hit: callbackProp(() => calls.push('hit')),
      mode: 'capture',
    });
    btn.dispatchEvent(new ME('click', { bubbles: true }));
    await vi.waitFor(() => {
      expect(names(emitted)).toContain('capture-fired');
      expect(calls).toEqual(['hit', 'hit']);
    });

    // Two modifiers in sequence (Once + Capture) — the options-modifier
    // loop strips both suffixes.
    await island.updateProps({ mode: 'oncecap' });
    btn.dispatchEvent(new ME('click', { bubbles: true }));
    await vi.waitFor(() => expect(names(emitted)).toContain('once-capture-fired'));
    btn.dispatchEvent(new ME('click', { bubbles: true }));
    await island.flush();
    await vi.waitFor(() =>
      expect(names(emitted).filter((n) => n === 'once-capture-fired')).toHaveLength(1),
    );

    island.destroy();
  });

  it('colon event names (on:x) attach a listener for x', async () => {
    const emitted: Array<{ name: string }> = [];
    const { el, island } = await mount('events', {}, (name) => emitted.push({ name }));
    const btn = el.querySelector('.ev-btn') as HTMLElement;
    btn.dispatchEvent(new (realDoc.defaultView as typeof window).CustomEvent('colon'));
    await vi.waitFor(() => expect(names(emitted)).toContain('colon-fired'));
    island.destroy();
  });
});

describe('vueIslandApp — style/class/form surface', () => {
  it('patches style objects, strings and removals with prev-diffing', async () => {
    const { el, island } = await mount('surface', {
      sty: { color: 'red', fontSize: '9px', '--mine': 'mv', margin: ['1px', '2px'] } as never,
      cls: { on: true, off: false } as never,
    });
    const styled = el.querySelector('.surface div') as HTMLElement;
    expect(styled.style.color).toBe('red');
    expect(styled.style.fontSize).toBe('9px');
    expect(styled.style.margin).toBe('1px'); // array → first entry
    expect(styled.className).toContain('on');
    expect(styled.className).not.toContain('off');

    // Object → object: removed keys clear to ''.
    await island.updateProps({ sty: { color: 'blue' }, cls: ['p', 'q'] });
    expect(styled.style.color).toBe('blue');
    expect(styled.style.fontSize).toBe('');
    expect(styled.className).toContain('p');
    expect(styled.className).not.toContain('on');

    // String → cssText; null → ''.
    await island.updateProps({ sty: 'color: green', cls: 'plain' });
    expect(styled.getAttribute('style')).toContain('color: green');
    expect(styled.className).toContain('plain');
    await island.updateProps({ sty: null, cls: null });
    expect(styled.getAttribute('style')).toBe('');
    expect(styled.className).toBe('');

    island.destroy();
  });

  it('writes innerHTML/textContent and reflects form props vs attributes', async () => {
    const { el, island } = await mount('surface', {
      html: '<b>h1</b>',
      txt: 'hello',
      val: 'abc',
      box: true,
      dis: true,
      sel: true,
      flag: true,
      zap: 7,
    });

    expect(el.querySelector('.s-html b')?.textContent).toBe('h1');
    expect(el.querySelector('.s-txt')?.textContent).toBe('hello');
    const input = el.querySelector('input.s-in') as HTMLInputElement;
    expect(input.value).toBe('abc');
    // The proxy emits `attr{name,''}` for presence attributes — the driver
    // maps '' onto a boolean live property as `true`, so checked/disabled
    // survive as real form state (presence-attr semantics).
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(true);
    expect(input.hasAttribute('selected')).toBe(true); // attr path, not accessor
    const flag = el.querySelector('.s-flag') as HTMLElement;
    expect(flag.getAttribute('data-flag')).toBe(''); // true → ''
    expect(flag.getAttribute('data-zap')).toBe('7');
    expect(flag.getAttribute('onlower')).toBe('lo'); // 'onlower' is not a listener

    await island.updateProps({
      html: null,
      txt: 'bye',
      val: null, // value ?? '' → ''
      box: false,
      dis: false,
      sel: false,
      flag: false, // → removeAttribute
      zap: { o: 1 }, // object → String(obj)
    });

    expect(el.querySelector('.s-html')?.innerHTML).toBe('');
    expect(el.querySelector('.s-txt')?.textContent).toBe('bye');
    expect(input.value).toBe('');
    // box/dis false → removeAttribute — and the removal path clears the
    // boolean live property too (line: `node[name] = false`).
    expect(input.checked).toBe(false);
    expect(input.disabled).toBe(false);
    expect(input.hasAttribute('selected')).toBe(false);
    expect(flag.hasAttribute('data-flag')).toBe(false);
    expect(flag.getAttribute('data-zap')).toBe('[object Object]');

    island.destroy();
  });
});

describe('vueIslandApp — markup host ops', () => {
  it('namespaces, scope ids, keyed reorder, comment anchors, text ops', async () => {
    const { el, island } = await mount('markup', {
      items: ['x', 'y', 'z'],
      mid: true,
      t: 'a',
    });

    // Namespaces ride the create op — real SVG/MathML elements land.
    const svg = el.querySelector('svg.mk-svg') as Element;
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(el.querySelector('math.mk-math')?.namespaceURI).toBe(
      'http://www.w3.org/1998/Math/MathML',
    );
    // scopeId → data-v-smk attribute on rendered elements.
    expect(el.querySelector('[data-v-smk]')).not.toBeNull();

    const texts = () => [...el.querySelectorAll('.mk-list li')].map((n) => n.textContent);
    expect(texts()).toEqual(['i-x', 'i-y', 'i-z']);
    const liX = el.querySelectorAll('.mk-list li')[0];

    // Keyed reorder → insertBefore moves, same nodes.
    await island.updateProps({ items: ['z', 'y', 'x'], mid: true, t: 'a' });
    expect(texts()).toEqual(['i-z', 'i-y', 'i-x']);
    expect(el.querySelectorAll('.mk-list li')[2]).toBe(liX);

    // Branch off/on anchors on a comment — the stable sibling survives.
    const stable = el.querySelector('.mk-stable');
    await island.updateProps({ items: ['z', 'y', 'x'], mid: false, t: 'b' });
    expect(el.querySelector('.mk-mid')).toBeNull();
    expect(el.querySelector('.mk-stable')).toBe(stable);
    await island.updateProps({ items: ['z', 'y', 'x'], mid: true, t: 'b' });
    expect(el.querySelector('.mk-mid')?.textContent).toBe('mid');

    // setElementText / setText through prop updates.
    expect(el.querySelector('.mk-text')?.textContent).toBe('text-only:b');
    expect(el.querySelector('.mk-mixed')?.textContent).toContain('text-node:b');

    island.destroy();
  });

  it('re-mounting a retained static vnode moves the cached range back in', async () => {
    const { el, island } = await mount('staticmove', { on: true, ver: 1 });
    expect(el.querySelector('.sm-b')?.textContent).toBe('S1');
    expect(el.querySelector('.sm-i')?.textContent).toBe('S2');
    expect(el.querySelector('.sm-v')?.textContent).toBe('v1');

    // Off → the static range is removed (vnode keeps its el/anchor refs).
    await island.updateProps({ on: false, ver: 1 });
    expect(el.querySelector('.sm-b')).toBeNull();

    // On → insertStaticContent's [start, end] branch sees a detached chain
    // (removal broke the nextSibling links) and falls back to re-parsing the
    // content string — both nodes come back, not just the head.
    await island.updateProps({ on: true, ver: 1 });
    expect(el.querySelector('.sm-b')?.textContent).toBe('S1');
    expect(el.querySelector('.sm-i')?.textContent).toBe('S2');

    // A changed content string reparses fresh (patchStaticNode).
    await island.updateProps({ on: true, ver: 2 });
    expect(el.querySelector('.sm-v')?.textContent).toBe('v2');

    island.destroy();
  });
});

describe('defineVueMonoWorker / vueIsland', () => {
  it('mounts its sole app and patches props', async () => {
    const { el, island } = await mount('main', { tag: 'm' });
    expect(el.querySelector('.mono')?.textContent).toBe('mono:m');
    await island.updateProps({ tag: 'm2' });
    expect(el.querySelector('.mono')?.textContent).toBe('mono:m2');
    island.destroy();
  });

  it('the vueIsland stamp names a mountable app', async () => {
    const { stampedApp } = await import('./fixtures/mono.worker');
    const { el, island } = await mount('stamped');
    expect(el.querySelector('.stamped')?.textContent).toBe('stamped!');
    expect((stampedApp as { islandAppName: string }).islandAppName).toBe('stamped');
    island.destroy();
  });
});
