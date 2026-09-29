// @vitest-environment happy-dom
/**
 * Coverage for the proxy DOM's leaf surface — the pieces real libraries
 * touch but the app-level tests never did: reflected-property accessors
 * (src/href/value/checked/…), the style/classList/dataset proxy traps,
 * geometry getters (pushed-size and honest-zero), attributeNS qualified-
 * name fallbacks, getElementsBy*, selector edge cases, CDATA parsing,
 * the window facade's timers/matchMedia/scroll stubs, and document-level
 * helpers. Ops drain off the instance queue; reads come from the shadow
 * tree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInInstance, takeOps, setInstanceSize } from '../src/worker/instance';
import {
  createProxyDocument,
  installDomShim,
  ProxyNode,
  type InternalDocument,
  type ProxyDocument,
} from '../src/worker/proxyDom';
import type { Op } from '../src/ops';

const inInstance = (instance: string, fn: () => void): Op[] =>
  runInInstance(instance, () => {
    fn();
    return takeOps(instance);
  });

const attrOps = (ops: Op[], name: string) =>
  ops.filter((o): o is Extract<Op, { t: 'attr' }> => o.t === 'attr' && o.name === name);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reflected properties', () => {
  it('attribute-backed accessors emit attr ops and read back', () => {
    const ops = inInstance('reflected', () => {
      const doc = createProxyDocument('reflected');
      const img = doc.createElement('img');
      doc.body.appendChild(img);

      img.id = 'hero';
      img.src = 'a.png';
      img.srcset = 'a.png 1x, b.png 2x';
      img.alt = 'hero shot';
      img.title = 'the hero';
      img.tabIndex = 2;
      img.draggable = true;
      img.crossOrigin = 'anonymous';
      img.width = 640;
      img.height = 480;
      img.loading = 'lazy';
      img.decoding = 'async';

      expect(img.id).toBe('hero');
      expect(img.src).toBe('a.png');
      expect(img.srcset).toBe('a.png 1x, b.png 2x');
      expect(img.alt).toBe('hero shot');
      expect(img.title).toBe('the hero');
      expect(img.tabIndex).toBe(2);
      expect(img.draggable).toBe(true);
      expect(img.crossOrigin).toBe('anonymous');
      expect(img.width).toBe(640);
      expect(img.height).toBe(480);
      expect(img.loading).toBe('lazy');
      expect(img.decoding).toBe('async');

      const link = doc.createElement('a');
      link.href = '#x';
      expect(link.href).toBe('#x');

      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.value = 'on';
      input.checked = true;
      input.disabled = true;
      expect(input.type).toBe('checkbox');
      expect(input.value).toBe('on');
      expect(input.checked).toBe(true);
      expect(input.disabled).toBe(true);
      input.checked = false;
      input.disabled = false;
      expect(input.checked).toBe(false);
      expect(input.disabled).toBe(false);

      // Same-value writes emit nothing; crossOrigin null removes.
      img.src = 'a.png';
      img.crossOrigin = null;
      expect(img.crossOrigin).toBeNull();
    });

    expect(attrOps(ops, 'src').length).toBe(1); // the identical re-write dedupes
    expect(attrOps(ops, 'checked').map((o) => o.value)).toEqual(['', null]);
    expect(attrOps(ops, 'crossorigin').map((o) => o.value)).toEqual(['anonymous', null]);
    expect(attrOps(ops, 'tabindex')[0].value).toBe('2');
  });
});

describe('attribute NS qualified-name fallbacks', () => {
  it('get/remove by local name resolve the qualified shadow key', () => {
    inInstance('nslocal', () => {
      const doc = createProxyDocument('nslocal');
      const el = doc.createElement('div');
      el.setAttributeNS('http://x', 'xlink:href', '#a');
      // Local-name lookup walks keys ending ':href'.
      expect(el.getAttributeNS('http://x', 'href')).toBe('#a');
      el.removeAttributeNS('http://x', 'href');
      expect(el.getAttribute('xlink:href')).toBeNull();
      // Qualified names pass straight through both surfaces.
      el.setAttribute('aria-label', 'ok');
      expect(el.getAttributeNS(null, 'aria-label')).toBe('ok');
      el.removeAttributeNS(null, 'aria-label');
      expect(el.hasAttribute('aria-label')).toBe(false);
    });
  });
});

describe('getElementsBy*', () => {
  it('tag and class search walk the shadow tree; props-className counts', () => {
    inInstance('search', () => {
      const doc = createProxyDocument('search');
      const host = doc.createElement('div');
      const a = doc.createElement('span');
      a.className = 'hit';
      const b = doc.createElement('b');
      b.setAttribute('class', 'hit other');
      const deep = doc.createElement('ul');
      const leaf = doc.createElement('li');
      leaf.className = 'hit';
      deep.appendChild(leaf);
      host.append(a, b, deep);
      doc.body.appendChild(host);

      expect(host.getElementsByClassName('hit').length).toBe(3);
      expect(host.getElementsByClassName('other')).toEqual([b]);
      expect(host.getElementsByClassName('nope')).toEqual([]);
      expect(host.getElementsByTagName('li')).toEqual([leaf]);
      expect(host.getElementsByTagName('*').length).toBe(4);
      expect(host.getElementsByTagName('table')).toEqual([]);

      // Adopted records expose their serialized props.className — a child
      // created by className-prop writes (React) still matches.
      const adopted = doc.createElement('i');
      (adopted.instance as { props?: Record<string, unknown> }).props = {
        className: 'hit fromprops',
      };
      host.appendChild(adopted);
      const hits = host.getElementsByClassName('fromprops');
      expect(hits).toEqual([adopted]);
    });
  });
});

describe('geometry and measurement', () => {
  it('honest zeros warn once per api; pushed size feeds the marked box', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    inInstance('geom', () => {
      const doc = createProxyDocument('geom');
      const el = doc.createElement('div');
      doc.body.appendChild(el);

      // No pushed size — everything reports 0 and warns (once per api).
      el.getBoundingClientRect();
      el.getBoundingClientRect();
      expect(el.clientWidth).toBe(0);
      expect(el.clientHeight).toBe(0);
      expect(el.offsetWidth).toBe(0);
      expect(el.offsetHeight).toBe(0);
      expect(el.getBBox()).toMatchObject({ width: 0, height: 0 });
      expect(el.getTotalLength()).toBe(0);
      expect(el.getComputedTextLength()).toBe(0);

      // Border/position surface: plain zeros, no warning needed.
      expect(el.clientLeft).toBe(0);
      expect(el.clientTop).toBe(0);
      expect(el.offsetLeft).toBe(0);
      expect(el.offsetTop).toBe(0);
      expect(el.offsetParent).toBeNull();

      // Scroll getters warn; setters are silent no-ops that warn.
      expect(el.scrollTop).toBe(0);
      el.scrollTop = 100;
      expect(el.scrollLeft).toBe(0);
      el.scrollLeft = 5;
      expect(el.scrollHeight).toBe(0);
      expect(el.scrollWidth).toBe(0);

      // The pushed container size flows to the marked element's box.
      setInstanceSize('geom', 800, 600);
      doc.markContainer(el);
      const rect = el.getBoundingClientRect();
      expect(rect.width).toBe(800);
      expect(rect.right).toBe(800);
      expect(rect.bottom).toBe(600);
      expect(rect.toJSON()).toEqual({});
      expect(el.clientWidth).toBe(800);
      expect(el.clientHeight).toBe(600);
      expect(el.offsetWidth).toBe(800);
      expect(el.offsetHeight).toBe(600);
    });
    // Each API warns at most once even with repeated calls (the _warned set).
    const countFor = (name: string) =>
      warnSpy.mock.calls.filter((c) => String(c[0]).includes(`'${name}'`)).length;
    expect(countFor('getBoundingClientRect')).toBe(1);
    expect(countFor('scrollTop')).toBe(1);
    warnSpy.mockRestore();
  });
});

describe('insertAdjacent*', () => {
  it('all four positions land relative to the element; orphan no-ops; bad position throws', () => {
    inInstance('adjacent', () => {
      const doc = createProxyDocument('adjacent');
      const host = doc.createElement('div');
      doc.body.appendChild(host);
      const mid = doc.createElement('b');
      mid.textContent = 'm';
      host.appendChild(mid);

      mid.insertAdjacentHTML('beforebegin', '<i>pre</i>');
      mid.insertAdjacentHTML('afterbegin', '<u>inner-first</u>');
      mid.insertAdjacentHTML('beforeend', '<u>inner-last</u>');
      mid.insertAdjacentHTML('afterend', '<i>post</i>');
      expect(host.innerHTML).toBe(
        '<i>pre</i><b><u>inner-first</u>m<u>inner-last</u></b><i>post</i>',
      );

      const el = doc.createElement('em');
      expect(mid.insertAdjacentElement('afterend', el)).toBe(el);
      expect(el.parentNode).toBe(host);
      expect(el.previousSibling).toBe(mid);
      // Non-element input is rejected the DOM way.
      expect(mid.insertAdjacentElement('beforeend', doc.createTextNode('x') as never)).toBeNull();
      // Orphan (no parent) positions no-op.
      const orphan = doc.createElement('p');
      orphan.insertAdjacentHTML('beforebegin', '<x></x>');
      orphan.insertAdjacentHTML('afterend', '<x></x>');
      expect(orphan.childNodes.length).toBe(0);
      expect(() => mid.insertAdjacentHTML('bogus' as never, '<x/>')).toThrow(/unknown position/);
    });
  });
});

describe('focus/blur and misc', () => {
  it('focus/blur are silent no-ops; hasAttribute; insertBefore/removeChild error paths', () => {
    inInstance('misc', () => {
      const doc = createProxyDocument('misc');
      const el = doc.createElement('div');
      expect(() => el.focus()).not.toThrow();
      expect(() => el.blur()).not.toThrow();
      expect(el.hasAttribute('title')).toBe(false);
      el.setAttribute('title', 't');
      expect(el.hasAttribute('title')).toBe(true);

      const text = doc.createTextNode('x');
      expect(() => text.appendChild(el)).toThrow(/cannot have children/);
      const comment = doc.createComment('c');
      expect(() => comment.appendChild(el)).toThrow(/cannot have children/);
      expect(() => el.insertBefore(text, doc.createElement('s'))).toThrow(
        /not a child of this node/,
      );
      expect(() => el.removeChild(doc.createElement('s'))).toThrow(/not a child of this node/);
      expect(() => el.appendChild({} as never)).toThrow();
      // The base kind guard — ProxyNode itself can't clone.
      expect(() => ProxyNode.prototype.cloneNode.call({} as ProxyNode)).toThrow(
        /unsupported node kind/,
      );
    });
  });
});

describe('classList / style / dataset traps', () => {
  it('classList add/remove/toggle dedupe, .value, and empty-token skip', () => {
    const ops = inInstance('classlist', () => {
      const doc = createProxyDocument('classlist');
      const el = doc.createElement('div');
      doc.body.appendChild(el);

      el.classList.add('a', 'b', '');
      expect(el.classList.contains('a')).toBe(true);
      expect(el.classList.contains('z')).toBe(false);
      expect(el.classList.value).toBe('a b');
      el.classList.add('a'); // no change → no op
      expect(el.classList.toggle('a')).toBe(false);
      expect(el.classList.toggle('a')).toBe(true);
      expect(el.classList.toggle('c', true)).toBe(true);
      expect(el.classList.toggle('c', true)).toBe(true); // forced same state
      el.classList.remove('b', 'missing');
      expect(el.classList.value).toBe('a c');
      el.className = '';
      expect(el.classList.contains('a')).toBe(false);
    });
    // Each effective mutation emits one attr op on 'class': add, toggle off,
    // toggle on, toggle c, remove, className='' — the no-ops emit none.
    const classOps = ops.filter((o) => o.t === 'attr' && o.name === 'class');
    expect(classOps.length).toBe(6);
  });

  it('style proxy: setProperty (kebab + custom + !important), removeProperty, getPropertyValue, cssText, traps', () => {
    const ops = inInstance('styleproxy', () => {
      const doc = createProxyDocument('styleproxy');
      const el = doc.createElement('div');
      doc.body.appendChild(el);
      const style = el.style;

      style.color = 'red';
      style.setProperty('font-size', '12px');
      style.setProperty('--brand', '#fff');
      style.setProperty('margin-top', '4px', 'important');
      expect(style.color).toBe('red');
      expect(style.getPropertyValue('font-size')).toBe('12px');
      expect(style.getPropertyValue('--brand')).toBe('#fff');
      expect(style.getPropertyValue('margin-top')).toBe('4px');
      expect(style.getPropertyValue('absent')).toBe('');
      expect(style.cssText).toContain('font-size: 12px;');

      // Non-string prop (symbol) reads undefined, delete works.
      expect(style[Symbol.iterator as never]).toBeUndefined();
      style.removeProperty('font-size');
      delete (style as unknown as Record<string, string>).color;
      expect(style.getPropertyValue('color')).toBe('');
      expect('fontSize' in style).toBe(true);
      expect(Object.keys(style)).toContain('--brand');
      expect(
        Object.getOwnPropertyDescriptor(style as object, '--brand')?.value,
      ).toBe('#fff');
      expect(Object.getOwnPropertyDescriptor(style as object, 'nope')).toBeUndefined();
    });
    const styleOps = ops.filter((o) => o.t === 'style');
    // important rides as a value suffix; keys carry camelized names.
    expect(styleOps.some((o) => o.props['marginTop'] === '4px !important')).toBe(true);
    expect(styleOps.some((o) => o.props['fontSize'] === '')).toBe(true);
  });

  it('dataset proxy: camelCase ↔ data-* mapping, has/ownKeys/descriptor/delete', () => {
    inInstance('dataset', () => {
      const doc = createProxyDocument('dataset');
      const el = doc.createElement('div');
      doc.body.appendChild(el);

      el.dataset.userName = 'jo';
      el.dataset.tallyCount = '3';
      expect(el.dataset.userName).toBe('jo');
      expect(el.getAttribute('data-user-name')).toBe('jo');
      expect('userName' in el.dataset).toBe(true);
      expect('nope' in el.dataset).toBe(false);
      expect(Object.keys(el.dataset).sort()).toEqual(['tallyCount', 'userName']);
      expect(
        Object.getOwnPropertyDescriptor(el.dataset as object, 'userName')?.value,
      ).toBe('jo');
      expect(Object.getOwnPropertyDescriptor(el.dataset as object, 'gone')).toBeUndefined();
      delete el.dataset.userName;
      expect(el.dataset.userName).toBeUndefined();
      expect(el.hasAttribute('data-user-name')).toBe(false);
      expect(el.dataset[Symbol.iterator as never]).toBeUndefined();
    });
  });
});

describe('document extras', () => {
  it('elementFromPoint warns + null; getComputedStyle warns + empty declaration', () => {
    const warns: string[] = [];
    inInstance('docextras2', () => {
      const doc = createProxyDocument('docextras2') as InternalDocument;
      doc._warn = (f: string) => warns.push(f);
      expect(doc.elementFromPoint(1, 2)).toBeNull();
      const cs = doc.getComputedStyle(doc.createElement('div'));
      expect(cs.getPropertyValue('color')).toBe('');
      expect((cs as unknown as Record<string, unknown>).display).toBe('');
      // A listener registered twice (same type+fn+capture) attaches once.
      const fn = () => {};
      doc.addEventListener('click', fn);
      doc.addEventListener('click', fn);
      doc.removeEventListener('click', fn);
      doc.dispose();
      expect(() => doc.elementFromPoint(0, 0)).toThrow(/disposed/);
    });
    expect(warns).toContain('elementFromPoint');
    expect(warns).toContain('getComputedStyle');
  });
});

describe('selector parsing edges', () => {
  it('rejects combinators/pseudos/groups, accepts attr selectors with quotes', () => {
    inInstance('sel', () => {
      const doc = createProxyDocument('sel');
      const host = doc.createElement('div');
      host.innerHTML = '<a href="#x">one</a><a href="#y">two</a><a>three</a>';
      doc.body.appendChild(host);

      expect(host.querySelectorAll('a[href]').length).toBe(2);
      expect(host.querySelectorAll('a[href="#y"]').length).toBe(1);
      expect(host.querySelectorAll("a[href='#x']").length).toBe(1);
      expect(host.querySelectorAll('a[href=#x]').length).toBe(1);

      for (const bad of ['a > b', 'a + b', 'a ~ b', 'a,b', 'a:hover', '', 'a[href', 'a[=x]']) {
        expect(() => host.querySelectorAll(bad)).toThrow(/unsupported/);
      }
      // Descendant combinator still works.
      expect(host.querySelectorAll('div a').length).toBe(3);
    });
  });
});

describe('innerHTML parser edge kinds', () => {
  it('CDATA inside foreign content flattens into the parent text', () => {
    inInstance('cdata', () => {
      const doc = createProxyDocument('cdata');
      const host = doc.createElement('div');
      // htmlparser2 only recognizes CDATA in foreign content (svg/math) —
      // top-level <![CDATA[ in HTML parses as a bogus comment per spec.
      host.innerHTML = '<svg><![CDATA[cdata text]]></svg>';
      expect(host.textContent).toBe('cdata text');
      doc.body.appendChild(host);
    });
  });
});

describe('window facade', () => {
  it('timers/rAF passthrough, matchMedia never matches, scroll stubs are silent', async () => {
    vi.useFakeTimers();
    try {
      const doc = createProxyDocument('winfacade');
      const uninstall = installDomShim(doc as unknown as ProxyDocument);
      const win = doc.defaultView!;

      let rafFired = -1;
      const rafId = win.requestAnimationFrame((t) => (rafFired = t));
      await vi.advanceTimersByTimeAsync(20);
      expect(rafFired).toBeGreaterThanOrEqual(0);

      const cancelId = win.requestAnimationFrame(() => {});
      win.cancelAnimationFrame(cancelId);
      win.cancelAnimationFrame(undefined);

      let timeoutFired = false;
      const tid = win.setTimeout(() => (timeoutFired = true), 10);
      await vi.advanceTimersByTimeAsync(15);
      expect(timeoutFired).toBe(true);
      const cid = win.setTimeout(() => {}, 10);
      win.clearTimeout(cid);
      win.clearTimeout(undefined);

      let ticks = 0;
      const iid = win.setInterval(() => ticks++, 10);
      await vi.advanceTimersByTimeAsync(35);
      expect(ticks).toBeGreaterThanOrEqual(3);
      win.clearInterval(iid);
      win.clearInterval(undefined);

      const mq = win.matchMedia('(min-width: 1px)');
      expect(mq.matches).toBe(false);
      expect(mq.media).toBe('(min-width: 1px)');
      expect(mq.dispatchEvent(new Event('change'))).toBe(false);
      mq.addListener(() => {});
      mq.removeListener(() => {});
      mq.addEventListener('change', () => {});
      mq.removeEventListener('change', () => {});

      expect(win.getComputedStyle({} as Element)).toEqual({});
      expect(win.devicePixelRatio).toBe(1);
      win.scrollTo(0, 0);
      win.scrollBy(0, 0);
      win.scroll({ top: 0 });
      win.location.reload();
      win.location.assign('x');
      win.location.replace('x');

      // window listeners land as listen ops on the island root (id 0).
      let heard = 0;
      const onPing = (): void => {
        heard++;
      };
      win.addEventListener('ping', onPing);
      win.addEventListener('ping', onPing); // deduped
      win.removeEventListener('ping', onPing);
      const ops = takeOps('winfacade');
      const listen = ops.filter(
        (o): o is Extract<Op, { t: 'listen' }> => o.t === 'listen' && o.type === 'ping',
      );
      const unlisten = ops.filter(
        (o): o is Extract<Op, { t: 'unlisten' }> => o.t === 'unlisten' && o.type === 'ping',
      );
      expect(listen.length).toBe(1);
      expect(listen[0].id).toBe(0);
      expect(unlisten.length).toBe(1);
      expect(heard).toBe(0);
      void rafId;

      uninstall();
      expect(globalThis.document).not.toBe(doc);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uninstall cancels pending facade timers', async () => {
    vi.useFakeTimers();
    try {
      const doc = createProxyDocument('winfacade2');
      const uninstall = installDomShim(doc as unknown as ProxyDocument);
      const win = doc.defaultView!;
      let fired = false;
      win.setTimeout(() => (fired = true), 10);
      uninstall();
      await vi.advanceTimersByTimeAsync(50);
      expect(fired).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
