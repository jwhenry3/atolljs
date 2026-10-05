// Tiny toast helper for panel feedback: toast('Applied'), toast(err, 'error').
// Stacks bottom-right; each toast removes itself after `ms`.

let host = null;

const ensureHost = () => {
  if (host?.isConnected) return host;
  host = document.createElement('div');
  host.setAttribute('aria-live', 'polite');
  host.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:6px;align-items:flex-end;pointer-events:none';
  document.body.appendChild(host);
  return host;
};

const COLORS = {
  ok: ['#0f2a1a', '#3fb950'],
  error: ['#2d1214', '#f85149'],
  info: ['#0d1d33', '#58a6ff'],
};

/** Show a transient message; `kind` is 'ok' | 'error' | 'info'. Errors accept an Error. */
export function toast(message, kind = 'ok', ms = kind === 'error' ? 5000 : 2600) {
  const text = message instanceof Error ? message.message : String(message);
  const [bg, fg] = COLORS[kind] ?? COLORS.info;
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    `background:${bg};color:#e6edf3;border:1px solid ${fg};border-left-width:4px;border-radius:6px;` +
    'padding:6px 10px;font:12px/1.4 system-ui,sans-serif;max-width:min(420px,calc(100vw - 24px));box-shadow:0 4px 14px #0008;' +
    'pointer-events:auto;transition:opacity .25s';
  ensureHost().appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, ms);
  return el;
}
