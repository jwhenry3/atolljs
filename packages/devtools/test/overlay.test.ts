// @vitest-environment happy-dom
/**
 * The overlay is pure DOM — mount it under happy-dom and drive the toggle,
 * drag, resize, and position anchors with synthetic pointer events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDevtoolsOverlay, parseHotkey, type DevtoolsOverlayPosition } from '../src/overlay';

const ptr = (type: string, x = 0, y = 0): PointerEvent =>
  new PointerEvent(type, { bubbles: true, clientX: x, clientY: y });
const key = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

const panel = () => document.querySelector('div') as HTMLElement;
const button = () =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'atoll devtools')!;
const closeBtn = (p: HTMLElement) =>
  [...p.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close atoll devtools')!;
const popLink = () => document.querySelector('a') as HTMLAnchorElement;

/** Stand-in for the iframe's window (happy-dom doesn't load the dashboard). */
const stubFrameWindow = (frame: HTMLIFrameElement, win: object) =>
  Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => win });

/** In-memory Storage — Node's own (flag-gated) localStorage global can shadow happy-dom's. */
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

describe('mountDevtoolsOverlay', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memStorage()));
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('mounts a collapsed toggle + hidden panel hosting the mini dashboard', () => {
    const o = mountDevtoolsOverlay();
    const frame = document.querySelector('iframe')!;
    expect(frame.src).toContain('/__atoll/?mini=1');
    expect(button().style.display).not.toBe('none');
    const p = frame.parentElement!;
    expect(p.style.display).toBe('none');
    // Default anchor: bottom-right.
    expect(p.style.right).toBe('16px');
    expect(p.style.bottom).toBe('16px');
    expect(p.style.width).toBe('760px');
    expect(p.style.height).toBe('580px');
    o.unmount();
  });

  it('honors src, size, and startOpen options', () => {
    const o = mountDevtoolsOverlay({
      src: '/custom/?mini=1',
      width: 400,
      height: 300,
      startOpen: true,
    });
    const p = panel();
    expect(document.querySelector('iframe')!.src).toContain('/custom/?mini=1');
    expect(p.style.width).toBe('400px');
    expect(p.style.height).toBe('300px');
    expect(p.style.display).toBe('flex');
    o.unmount();
  });

  it.each<[DevtoolsOverlayPosition, string, string]>([
    ['topleft', 'left', '12px'],
    ['topcenter', 'transform', 'translateX(-50%)'],
    ['topright', 'right', '12px'],
    ['bottomleft', 'left', '12px'],
    ['bottomcenter', 'transform', 'translateX(-50%)'],
    ['bottomright', 'right', '12px'],
  ])('anchors the toggle at %s', (position, prop, want) => {
    const o = mountDevtoolsOverlay({ position });
    expect((button().style as unknown as Record<string, string>)[prop]).toBe(want);
    o.unmount();
  });

  it('toggles between the button and the panel', () => {
    const o = mountDevtoolsOverlay();
    const p = panel();
    o.open();
    expect(p.style.display).toBe('flex');
    expect(button().style.display).toBe('none');
    expect(button().getAttribute('aria-expanded')).toBe('true');
    o.toggle();
    expect(p.style.display).toBe('none');
    // The header close button flips back to the toggle.
    o.open();
    closeBtn(p).click();
    expect(p.style.display).toBe('none');
    expect(button().style.display).toBe('block');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    // The toggle button re-opens.
    button().click();
    expect(p.style.display).toBe('flex');
    o.unmount();
  });

  it('is labeled for assistive tech', () => {
    const o = mountDevtoolsOverlay();
    const p = panel();
    expect(p.getAttribute('role')).toBe('dialog');
    expect(button().getAttribute('aria-controls')).toBe(p.id);
    expect(document.querySelector('iframe')!.title).toBe('atoll devtools dashboard');
    expect(closeBtn(p).title).toContain('Alt+Shift+D');
    o.unmount();
  });

  it('drags the panel by its header and keeps the title bar on screen', () => {
    const o = mountDevtoolsOverlay({ startOpen: true, position: 'bottomcenter' });
    const p = panel();
    const head = p.firstElementChild as HTMLElement;
    head.dispatchEvent(ptr('pointerdown', 100, 100));
    dispatchEvent(ptr('pointermove', 120, 140));
    dispatchEvent(ptr('pointerup'));
    // getBoundingClientRect is 0-sized under happy-dom — the clamp still
    // rewrites to explicit left/top and drops the center translate.
    expect(p.style.transform).toBe('none');
    expect(p.style.top).toBeDefined();
    expect(p.style.right).toBe('auto');
    o.unmount();
  });

  it('ignores header drags that start on a link or button', () => {
    const o = mountDevtoolsOverlay({ startOpen: true });
    const p = panel();
    closeBtn(p).dispatchEvent(ptr('pointerdown', 5, 5));
    dispatchEvent(ptr('pointermove', 50, 50));
    dispatchEvent(ptr('pointerup'));
    expect(p.style.right).toBe('16px'); // anchor untouched — no drag ran
    o.unmount();
  });

  it('resizes via the corner grip with a 340×220 floor', () => {
    const o = mountDevtoolsOverlay({ startOpen: true });
    const p = panel();
    const grip = p.querySelector('div:last-child') as HTMLElement;
    grip.dispatchEvent(ptr('pointerdown', 10, 10));
    dispatchEvent(ptr('pointermove', -1000, -1000));
    dispatchEvent(ptr('pointerup'));
    expect(p.style.width).toBe('340px');
    expect(p.style.height).toBe('220px');
    o.unmount();
  });

  const edge = (p: HTMLElement, e: string) => p.querySelector(`[data-edge="${e}"]`) as HTMLElement;
  const dragBy = (el: HTMLElement, dx: number, dy: number) => {
    el.dispatchEvent(ptr('pointerdown', 0, 0));
    dispatchEvent(ptr('pointermove', dx, dy));
    dispatchEvent(ptr('pointerup'));
  };
  const box = (p: HTMLElement) => ['left', 'top', 'width', 'height'].map((k) => parseFloat((p.style as unknown as Record<string, string>)[k]));

  it('keeps the whole panel, close button included, inside the viewport while dragging', () => {
    const o = mountDevtoolsOverlay({ startOpen: true });
    const p = panel();
    dragBy(p.firstElementChild as HTMLElement, 5000, 5000);
    const [left, top, w, h] = box(p);
    expect(left + w).toBe(innerWidth);
    expect(top + h).toBe(innerHeight);
    dragBy(p.firstElementChild as HTMLElement, -9000, -9000);
    expect(box(p).slice(0, 2)).toEqual([0, 0]);
    o.unmount();
  });

  it('resizes from the left and top edges, moving the panel and keeping the floor', () => {
    const o = mountDevtoolsOverlay({ startOpen: true, width: 500, height: 400 });
    const p = panel();
    dragBy(p.firstElementChild as HTMLElement, 200, 100);
    expect(box(p)).toEqual([200, 100, 500, 400]);
    dragBy(edge(p, 'w'), -50, 0);
    expect(box(p)).toEqual([150, 100, 550, 400]);
    dragBy(edge(p, 'n'), 0, 1000);
    expect(box(p)).toEqual([150, 100 + 400 - 220, 550, 220]);
    dragBy(edge(p, 'nw'), -9000, -9000);
    const [left, top] = box(p);
    expect([left, top]).toEqual([0, 0]);
    o.unmount();
  });

  it('stops edge resizes at the viewport and refits when the window shrinks', () => {
    const o = mountDevtoolsOverlay({ startOpen: true });
    const p = panel();
    dragBy(edge(p, 'e'), 5000, 0);
    expect(box(p)[2]).toBe(innerWidth);
    const was = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    try {
      dispatchEvent(new Event('resize'));
      const [left, , w] = box(p);
      expect(w).toBe(500);
      expect(left).toBe(0);
    } finally {
      if (was) Object.defineProperty(window, 'innerWidth', was);
      else delete (window as { innerWidth?: number }).innerWidth;
    }
    o.unmount();
  });

  it('unmount removes both the panel and the toggle', () => {
    const o = mountDevtoolsOverlay();
    o.unmount();
    expect(document.querySelector('iframe')).toBeNull();
    expect([...document.querySelectorAll('button')].find((b) => b.textContent === 'atoll devtools')).toBeUndefined();
  });

  describe('full page link', () => {
    it("carries the iframe's hash route", () => {
      const o = mountDevtoolsOverlay({ startOpen: true });
      stubFrameWindow(document.querySelector('iframe')!, {
        location: { hash: '#/dashboard/tv-island?island=s1|app@1' },
      });
      popLink().dispatchEvent(new Event('focus'));
      expect(popLink().getAttribute('href')).toBe('/__atoll/#/dashboard/tv-island?island=s1|app@1');
      o.unmount();
    });

    it('stays relative to a relative src and drops its query', () => {
      const o = mountDevtoolsOverlay({ src: 'app/__atoll/?mini=1#/tasks', startOpen: true });
      stubFrameWindow(document.querySelector('iframe')!, { location: { hash: '#/network' } });
      popLink().dispatchEvent(new Event('pointerenter'));
      expect(popLink().getAttribute('href')).toBe('app/__atoll/#/network');
      o.unmount();
    });

    it('falls back to the route the dashboard posts when the frame is unreadable', () => {
      const o = mountDevtoolsOverlay({ startOpen: true });
      const win = {
        get location(): Location { throw new Error('cross-origin'); },
      };
      stubFrameWindow(document.querySelector('iframe')!, win);
      dispatchEvent(new MessageEvent('message', { data: { type: 'atoll-devtools:route', hash: '#/memory' }, source: win as Window }));
      // a non-route hash and foreign sources are ignored
      dispatchEvent(new MessageEvent('message', { data: { type: 'atoll-devtools:route', hash: 'javascript:x' }, source: win as Window }));
      dispatchEvent(new MessageEvent('message', { data: { type: 'atoll-devtools:route', hash: '#/log' } }));
      popLink().dispatchEvent(new Event('focus'));
      expect(popLink().getAttribute('href')).toBe('/__atoll/#/memory');
      o.unmount();
    });
  });

  describe('keyboard toggle', () => {
    it('toggles on Alt+Shift+D from the host page', () => {
      const o = mountDevtoolsOverlay();
      const p = panel();
      const ev = key({ key: 'Î', code: 'KeyD', altKey: true, shiftKey: true });
      dispatchEvent(ev);
      expect(p.style.display).toBe('flex');
      expect(ev.defaultPrevented).toBe(true);
      dispatchEvent(key({ key: 'D', code: 'KeyD', altKey: true, shiftKey: true }));
      expect(p.style.display).toBe('none');
      // plain D (or missing modifiers) does nothing
      dispatchEvent(key({ key: 'd', code: 'KeyD' }));
      dispatchEvent(key({ key: 'D', code: 'KeyD', shiftKey: true }));
      expect(p.style.display).toBe('none');
      o.unmount();
    });

    it('toggles when the dashboard iframe forwards the chord', () => {
      const o = mountDevtoolsOverlay({ startOpen: true });
      const win = { location: { hash: '' } };
      stubFrameWindow(document.querySelector('iframe')!, win);
      dispatchEvent(new MessageEvent('message', { data: { type: 'atoll-devtools:toggle' }, source: win as unknown as Window }));
      expect(panel().style.display).toBe('none');
      o.unmount();
    });

    it('honors a custom hotkey and hotkey: false; unmount detaches it', () => {
      const a = mountDevtoolsOverlay({ hotkey: 'Ctrl+Shift+1', persist: false });
      dispatchEvent(key({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }));
      expect(panel().style.display).toBe('flex');
      a.unmount();
      dispatchEvent(key({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true })); // no throw, no listener
      const b = mountDevtoolsOverlay({ hotkey: false });
      dispatchEvent(key({ key: 'D', code: 'KeyD', altKey: true, shiftKey: true }));
      expect(panel().style.display).toBe('none');
      b.unmount();
    });

    it('parses hotkey specs', () => {
      const m = parseHotkey('Alt+Shift+D');
      expect(m(key({ code: 'KeyD', key: 'd', altKey: true, shiftKey: true }))).toBe(true);
      expect(m(key({ code: 'KeyD', key: 'd', altKey: true, shiftKey: true, ctrlKey: true }))).toBe(false);
      expect(parseHotkey('Cmd+Escape')(key({ key: 'Escape', metaKey: true }))).toBe(true);
    });
  });

  describe('persistence', () => {
    it('remembers open state, size and position across mounts', () => {
      const a = mountDevtoolsOverlay();
      a.open();
      const p = panel();
      const grip = p.querySelector('div:last-child') as HTMLElement;
      grip.dispatchEvent(ptr('pointerdown', 0, 0));
      dispatchEvent(ptr('pointermove', 500, 400));
      dispatchEvent(ptr('pointerup'));
      const head = p.firstElementChild as HTMLElement;
      head.dispatchEvent(ptr('pointerdown', 0, 0));
      dispatchEvent(ptr('pointermove', 30, 20));
      dispatchEvent(ptr('pointerup'));
      const { width, height, left, top } = p.style;
      a.unmount();

      const b = mountDevtoolsOverlay();
      const q = panel();
      expect(q.style.display).toBe('flex');
      expect([q.style.width, q.style.height]).toEqual([width, height]);
      expect([q.style.left, q.style.top]).toEqual([left, top]);
      expect(q.style.right).toBe('auto');
      b.unmount();
    });

    it('does not freeze untouched options, and startOpen beats the memory', () => {
      const a = mountDevtoolsOverlay({ width: 500 });
      a.open();
      a.unmount();
      const b = mountDevtoolsOverlay({ width: 600, startOpen: false });
      expect(panel().style.width).toBe('600px');
      expect(panel().style.display).toBe('none');
      b.unmount();
    });

    it('persist: false writes nothing; a string picks the key', () => {
      const a = mountDevtoolsOverlay({ persist: false });
      a.open();
      a.unmount();
      expect(localStorage.length).toBe(0);
      const b = mountDevtoolsOverlay({ persist: 'my-key' });
      b.open();
      b.unmount();
      expect(JSON.parse(localStorage.getItem('my-key')!)).toMatchObject({ open: true });
    });
  });
});
