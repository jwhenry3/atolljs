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
  /** Start expanded (default false — a small corner toggle shows first). */
  startOpen?: boolean;
  /** Initial size (default 760×580). */
  width?: number;
  height?: number;
  /** Where the flyout (and its collapsed toggle) anchors — default 'bottomright'. */
  position?: DevtoolsOverlayPosition;
}

export interface DevtoolsOverlay {
  open(): void;
  close(): void;
  toggle(): void;
  unmount(): void;
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

export function mountDevtoolsOverlay(opts: DevtoolsOverlayOptions = {}): DevtoolsOverlay {
  const src = opts.src ?? '/__atoll/?mini=1';
  const W = opts.width ?? 760;
  const H = opts.height ?? 580;
  const anchor = ANCHOR[opts.position ?? 'bottomright'];
  let open = false;

  const btn = document.createElement('button');
  btn.textContent = 'atoll devtools';
  btn.style.cssText = `${BTN_STYLE};${anchor(12)}`;

  const panel = document.createElement('div');
  panel.style.cssText =
    `${PANEL_STYLE};width:${W}px;height:${H}px;display:none;${anchor(16)}`;

  const head = document.createElement('div');
  head.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:5px 10px;flex:none;' +
    'border-bottom:1px solid #21262d;font:11px ui-monospace,monospace;' +
    'color:#8b949e;background:#161b22;cursor:move;user-select:none';
  head.textContent = 'atoll devtools';

  const pop = document.createElement('a');
  pop.href = '/__atoll/';
  pop.target = '_blank';
  pop.rel = 'noopener';
  pop.textContent = 'full page ↗';
  pop.style.cssText = 'color:#58a6ff;text-decoration:none;margin-left:auto';
  const x = document.createElement('button');
  x.textContent = '—';
  x.title = 'collapse';
  x.style.cssText =
    'color:#8b949e;background:none;border:none;cursor:pointer;font:inherit;padding:0 2px';
  head.append(pop, x);

  const frame = document.createElement('iframe');
  frame.src = src;
  frame.style.cssText = 'flex:1;border:0;background:#0d1117;min-height:0';

  // manual resize grip — CSS `resize` doesn't work over an iframe
  const grip = document.createElement('div');
  grip.style.cssText =
    'position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;' +
    'background:linear-gradient(135deg,transparent 50%,#30363d 50%);border-radius:0 0 7px';
  panel.append(head, frame, grip);
  document.body.append(panel, btn);

  /** Pointer-drag helper: run `move` on pointermove until pointerup. */
  const drag = (e: PointerEvent, move: (dx: number, dy: number) => void) => {
    e.preventDefault();
    let lx = e.clientX, ly = e.clientY;
    const mm = (ev: PointerEvent) => {
      move(ev.clientX - lx, ev.clientY - ly);
      lx = ev.clientX; ly = ev.clientY;
    };
    const up = () => {
      removeEventListener('pointermove', mm);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', mm);
    addEventListener('pointerup', up);
  };

  head.onpointerdown = (e) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    drag(e, (dx, dy) => {
      const r = panel.getBoundingClientRect();
      // keep at least 40px of the title bar on screen
      const left = Math.min(Math.max(0, r.left + dx), innerWidth - 60);
      const top = Math.min(Math.max(0, r.top + dy), innerHeight - 40);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none'; // drop the center anchor's translateX
    });
  };

  grip.onpointerdown = (e) => {
    e.stopPropagation();
    drag(e, (dx, dy) => {
      const r = panel.getBoundingClientRect();
      panel.style.width = `${Math.max(340, r.width + dx)}px`;
      panel.style.height = `${Math.max(220, r.height + dy)}px`;
    });
  };

  const set = (v: boolean) => {
    open = v;
    panel.style.display = v ? 'flex' : 'none';
    btn.style.display = v ? 'none' : 'block';
  };
  btn.onclick = () => set(true);
  x.onclick = () => set(false);
  set(opts.startOpen === true);

  return {
    open: () => set(true),
    close: () => set(false),
    toggle: () => set(!open),
    unmount: () => {
      panel.remove();
      btn.remove();
    },
  };
}
