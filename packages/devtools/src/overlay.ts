/**
 * In-app devtools overlay: a floating flyout hosting the mini dashboard
 * in a same-origin iframe (default /__atoll/?mini=1, served by the vite
 * plugin). Same-origin means the iframe shares the app's BroadcastChannel
 * — the pure-client transport needs no other wiring.
 *
 *   import { connectDevtools, mountDevtoolsOverlay } from '@atolljs/devtools';
 *   if (import.meta.env.DEV) {
 *     connectDevtools();
 *     mountDevtoolsOverlay();
 *   }
 *
 * Alt+Shift+D toggles the flyout from the host page (`hotkey` option). The
 * dashboard inside the iframe forwards the same chord via postMessage, so
 * it works wherever focus is. "full page ↗" opens the dashboard on the
 * view the flyout is showing (its `#/<view>…` hash route).
 */

export type DevtoolsOverlayPosition =
  | 'topleft'
  | 'topcenter'
  | 'topright'
  | 'bottomleft'
  | 'bottomcenter'
  | 'bottomright';

export interface DevtoolsOverlayOptions {
  /** Dashboard URL — default '/__atoll/?mini=1' (vite-plugin mount, mini layout). */
  src?: string;
  /** Start expanded (default: the remembered state, else collapsed to a corner toggle). */
  startOpen?: boolean;
  /** Initial size (default 760×580; a remembered resize wins). */
  width?: number;
  height?: number;
  /** Where the flyout (and its collapsed toggle) anchors — default 'bottomright'. */
  position?: DevtoolsOverlayPosition;
  /**
   * Remember position, size and open state in localStorage across reloads —
   * default true; a string is the storage key (default 'atoll-devtools:overlay').
   */
  persist?: boolean | string;
  /** Host-page shortcut that toggles the flyout — default 'Alt+Shift+D'; false disables. */
  hotkey?: string | false;
}

export interface DevtoolsOverlay {
  open(): void;
  close(): void;
  toggle(): void;
  unmount(): void;
}

interface Saved {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  open?: boolean;
}

const BTN_STYLE =
  'position:fixed;z-index:2147483646;' +
  'font:11px ui-monospace,monospace;color:#c9d1d9;background:#161b22;' +
  'border:1px solid #30363d;border-radius:6px;padding:5px 9px;cursor:pointer';

const PANEL_STYLE =
  'position:fixed;z-index:2147483646;display:flex;flex-direction:column;' +
  'background:#0d1117;border:1px solid #30363d;border-radius:8px;' +
  'box-shadow:0 12px 40px #000c;overflow:hidden;min-width:340px;min-height:220px';

const ANCHOR: Record<DevtoolsOverlayPosition, (m: number) => string> = {
  topleft: (m) => `left:${m}px;top:${m}px`,
  topcenter: (m) => `left:50%;top:${m}px;transform:translateX(-50%)`,
  topright: (m) => `right:${m}px;top:${m}px`,
  bottomleft: (m) => `left:${m}px;bottom:${m}px`,
  bottomcenter: (m) => `left:50%;bottom:${m}px;transform:translateX(-50%)`,
  bottomright: (m) => `right:${m}px;bottom:${m}px`,
};

const MIN_W = 340;
const MIN_H = 220;
let seq = 0;

/** 'Alt+Shift+D' → a keydown predicate. Letters/digits match on `code`, so Alt/Option layouts still hit. */
export function parseHotkey(spec: string): (e: KeyboardEvent) => boolean {
  const parts = spec.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((m) => (m === 'option' ? 'alt' : m === 'cmd' || m === 'meta' ? 'meta' : m === 'control' ? 'ctrl' : m)));
  const code = /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : null;
  return (e) =>
    e.altKey === mods.has('alt') &&
    e.shiftKey === mods.has('shift') &&
    e.ctrlKey === mods.has('ctrl') &&
    e.metaKey === mods.has('meta') &&
    (code ? e.code === code : e.key.toLowerCase() === key);
}

export function mountDevtoolsOverlay(opts: DevtoolsOverlayOptions = {}): DevtoolsOverlay {
  const src = opts.src ?? '/__atoll/?mini=1';
  const storeKey = opts.persist === false ? null : typeof opts.persist === 'string' ? opts.persist : 'atoll-devtools:overlay';
  const load = (): Saved => {
    if (!storeKey) return {};
    try { return JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Saved; } catch { return {}; }
  };
  const saved = load();
  const W = Math.max(MIN_W, saved.width ?? opts.width ?? 760);
  const H = Math.max(MIN_H, saved.height ?? opts.height ?? 580);
  const anchor = ANCHOR[opts.position ?? 'bottomright'];
  const hotkey = opts.hotkey === false ? null : opts.hotkey ?? 'Alt+Shift+D';
  const isHotkey = hotkey ? parseHotkey(hotkey) : null;
  const hint = hotkey ? ` (${hotkey})` : '';
  const id = `atoll-devtools-overlay-${++seq}`;
  let open = false;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'atoll devtools';
  btn.title = `Open atoll devtools${hint}`;
  btn.setAttribute('aria-controls', id);
  btn.setAttribute('aria-expanded', 'false');
  btn.style.cssText = `${BTN_STYLE};${anchor(12)}`;

  const panel = document.createElement('div');
  panel.id = id;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'atoll devtools');
  panel.style.cssText =
    `${PANEL_STYLE};width:${W}px;height:${H}px;display:none;${anchor(16)}`;

  const head = document.createElement('div');
  head.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:5px 10px;flex:none;' +
    'border-bottom:1px solid #21262d;font:11px ui-monospace,monospace;' +
    'color:#8b949e;background:#161b22;cursor:move;user-select:none';
  const title = document.createElement('span');
  title.textContent = 'atoll devtools';

  // Full-page dashboard = src minus its query/hash — stays relative when the
  // caller passes a relative src (e.g. '__atoll/?mini=1' under a mounted
  // base path where absolute /__atoll/ would escape the mount) — plus the
  // iframe's current hash route, so the tab opens on the same view.
  const base = src.split(/[?#]/)[0];
  const frame = document.createElement('iframe');
  let route = '';
  const currentRoute = (): string => {
    try {
      const h = frame.contentWindow?.location.hash;
      if (typeof h === 'string' && h.startsWith('#/')) return h;
    } catch { /* cross-origin src: rely on posted routes */ }
    return route;
  };
  const pop = document.createElement('a');
  pop.href = base;
  pop.target = '_blank';
  pop.rel = 'noopener';
  pop.textContent = 'full page ↗';
  pop.title = 'Open this view in the full-page dashboard';
  pop.style.cssText = 'color:#58a6ff;text-decoration:none;margin-left:auto';
  const syncPop = () => { pop.href = base + currentRoute(); };
  pop.addEventListener('pointerenter', syncPop);
  pop.addEventListener('focus', syncPop);
  pop.addEventListener('click', syncPop); // runs before the default navigation
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = '×';
  x.title = `Close${hint}`;
  x.setAttribute('aria-label', 'Close atoll devtools');
  x.style.cssText =
    'color:#8b949e;background:none;border:none;cursor:pointer;font:14px/1 ui-monospace,monospace;padding:0 2px';
  head.append(title, pop, x);

  frame.src = src;
  frame.title = 'atoll devtools dashboard';
  frame.style.cssText = 'flex:1;border:0;background:#0d1117;min-height:0';

  // manual resize grip — CSS `resize` doesn't work over an iframe
  const grip = document.createElement('div');
  grip.setAttribute('aria-hidden', 'true');
  grip.style.cssText =
    'position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;' +
    'background:linear-gradient(135deg,transparent 50%,#30363d 50%);border-radius:0 0 7px';
  panel.append(head, frame, grip);
  document.body.append(panel, btn);

  const placeAt = (left: number, top: number) => {
    // keep at least 40px of the title bar on screen
    panel.style.left = `${Math.min(Math.max(0, left), Math.max(0, innerWidth - 60))}px`;
    panel.style.top = `${Math.min(Math.max(0, top), Math.max(0, innerHeight - 40))}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none'; // drop the center anchor's translateX
  };
  if (typeof saved.left === 'number' && typeof saved.top === 'number') placeAt(saved.left, saved.top);

  // Only what the user changed is remembered: an untouched size/position
  // keeps following the options.
  const mem: Saved = { ...saved };
  const save = (what: 'open' | 'move' | 'size') => {
    if (!storeKey) return;
    if (what === 'open') mem.open = open;
    if (what === 'size') {
      mem.width = parseFloat(panel.style.width);
      mem.height = parseFloat(panel.style.height);
    }
    if (what === 'move') {
      mem.left = parseFloat(panel.style.left);
      mem.top = parseFloat(panel.style.top);
    }
    try { localStorage.setItem(storeKey, JSON.stringify(mem)); } catch { /* storage off */ }
  };

  /** Pointer-drag helper: run `move` on pointermove until pointerup. */
  const drag = (e: PointerEvent, what: 'move' | 'size', move: (dx: number, dy: number) => void) => {
    e.preventDefault();
    let lx = e.clientX, ly = e.clientY;
    // the iframe would swallow pointermove while the cursor is over it
    frame.style.pointerEvents = 'none';
    const mm = (ev: PointerEvent) => {
      move(ev.clientX - lx, ev.clientY - ly);
      lx = ev.clientX; ly = ev.clientY;
    };
    const up = () => {
      removeEventListener('pointermove', mm);
      removeEventListener('pointerup', up);
      frame.style.pointerEvents = '';
      save(what);
    };
    addEventListener('pointermove', mm);
    addEventListener('pointerup', up);
  };

  head.onpointerdown = (e) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    drag(e, 'move', (dx, dy) => {
      const r = panel.getBoundingClientRect();
      placeAt(r.left + dx, r.top + dy);
    });
  };

  grip.onpointerdown = (e) => {
    e.stopPropagation();
    drag(e, 'size', (dx, dy) => {
      const r = panel.getBoundingClientRect();
      panel.style.width = `${Math.max(MIN_W, r.width + dx)}px`;
      panel.style.height = `${Math.max(MIN_H, r.height + dy)}px`;
    });
  };

  const set = (v: boolean, focus = false, persist = true) => {
    const hadFocus = panel.contains(document.activeElement);
    open = v;
    panel.style.display = v ? 'flex' : 'none';
    btn.style.display = v ? 'none' : 'block';
    btn.setAttribute('aria-expanded', String(v));
    if (v && focus) frame.focus();
    if (!v && hadFocus) btn.focus();
    if (persist) save('open');
  };
  btn.onclick = () => set(true, true);
  x.onclick = () => set(false);

  const onKey = (e: KeyboardEvent) => {
    if (!isHotkey?.(e)) return;
    e.preventDefault();
    set(!open, true);
  };
  const onMessage = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || !e.data || typeof e.data !== 'object') return;
    const d = e.data as { type?: string; hash?: unknown };
    if (d.type === 'atoll-devtools:toggle') set(!open);
    else if (d.type === 'atoll-devtools:route' && typeof d.hash === 'string' && d.hash.startsWith('#/')) {
      route = d.hash;
    }
  };
  if (isHotkey) addEventListener('keydown', onKey);
  addEventListener('message', onMessage);

  set(opts.startOpen ?? saved.open === true, false, false);

  return {
    open: () => set(true),
    close: () => set(false),
    toggle: () => set(!open),
    unmount: () => {
      removeEventListener('keydown', onKey);
      removeEventListener('message', onMessage);
      panel.remove();
      btn.remove();
    },
  };
}
