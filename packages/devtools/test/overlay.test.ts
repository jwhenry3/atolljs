// @vitest-environment happy-dom
/**
 * The overlay is pure DOM — mount it under happy-dom and drive the toggle,
 * drag, resize, and position anchors with synthetic pointer events.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountDevtoolsOverlay, type DevtoolsOverlayPosition } from '../src/overlay';

const ptr = (type: string, x = 0, y = 0): PointerEvent =>
  new PointerEvent(type, { bubbles: true, clientX: x, clientY: y });

const panel = () => document.querySelector('div') as HTMLElement;
const button = () =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'atoll devtools')!;

describe('mountDevtoolsOverlay', () => {
  afterEach(() => {
    document.body.replaceChildren();
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
    o.toggle();
    expect(p.style.display).toBe('none');
    // The header collapse button flips back to the toggle.
    o.open();
    const x = [...p.querySelectorAll('button')].find((b) => b.title === 'collapse')!;
    x.click();
    expect(p.style.display).toBe('none');
    expect(button().style.display).toBe('block');
    // The toggle button re-opens.
    button().click();
    expect(p.style.display).toBe('flex');
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
    const x = [...p.querySelectorAll('button')].find((b) => b.title === 'collapse')!;
    x.dispatchEvent(ptr('pointerdown', 5, 5));
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

  it('unmount removes both the panel and the toggle', () => {
    const o = mountDevtoolsOverlay();
    o.unmount();
    expect(document.querySelector('iframe')).toBeNull();
    expect([...document.querySelectorAll('button')].find((b) => b.textContent === 'atoll devtools')).toBeUndefined();
  });
});
