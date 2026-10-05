// Panel side of the push relay, transport-free so it tests in Node: the
// panel bootstrap (bridge.js) plugs in chrome.runtime.connect and the
// inspected tab id.
import { PANEL_PORT, isAppFrame, isViewerFrame } from './frames.js';

export const STATUS_LABELS = {
  connecting: 'connecting…',
  waiting: 'no atoll session',
  live: 'inspected page',
  reload: 'reload the page to connect',
  unreachable: 'page not inspectable',
};

export const BRIDGE_DEFAULTS = {
  /** Reconnect delays after the hub port drops (service worker restart), then the last one. */
  reconnectMs: [250, 1000, 2000],
  /** Keepalive while the port is open: messages, not open ports, keep an MV3 service worker alive. */
  pingMs: 15_000,
  /** Viewer frames held while no page is attached; oldest dropped past this. */
  outboxCap: 200,
};

/**
 * BroadcastChannel-shaped bridge for the dashboard (`window.__ATOLL_BRIDGE`):
 * `postMessage(msg)` / `onmessage({ data })` like the channel main.js uses
 * in broadcast mode, plus `onreset()` when the inspected page navigated
 * (a new page port after an earlier one) and `onstatus(status)`.
 *
 * The hub port opens once `onmessage` is assigned, so no frame lands before
 * the dashboard listens.
 *
 * @param {{
 *   connect: (info: { name: string }) => any,
 *   tabId: number | null | undefined,
 *   timers?: {
 *     setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout,
 *     setInterval: typeof setInterval, clearInterval: typeof clearInterval,
 *   },
 *   options?: Partial<typeof BRIDGE_DEFAULTS>,
 * }} deps
 */
export function createPushBridge({ connect, tabId, timers = globalThis, options = {} }) {
  const opts = { ...BRIDGE_DEFAULTS, ...options };
  let handler = null;
  let port = null;
  let attached = false;
  let everAttached = false; // a later 'attached' (after a port reconnect) means frames were missed
  let detected = false;
  let closed = false;
  let started = false;
  let reconnects = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let outbox = [];
  let status = 'connecting';

  const setStatus = (s) => {
    if (s === status) return;
    status = s;
    bridge.onstatus?.(s);
  };

  const deliver = (frame) => {
    try { handler?.({ data: frame }); } catch (err) { console.error('[atoll devtools] frame handler failed', err); }
  };

  const sendFrame = (frame) => {
    try { port.postMessage({ type: 'frame', frame }); } catch { /* port dropping: onDisconnect reconnects */ }
  };

  const flush = () => {
    const out = outbox;
    outbox = [];
    for (const f of out) sendFrame(f);
  };

  const reset = () => {
    outbox = [];
    if (bridge.onreset) bridge.onreset();
    else outbox.push({ type: 'view' });
    flush();
  };

  function onHub(msg) {
    if (closed || !msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'attached':
      case 'reset': {
        const navigated = msg.type === 'reset' || everAttached;
        attached = true;
        everAttached = true;
        detected = false;
        setStatus('waiting');
        if (navigated) reset();
        else flush();
        return;
      }
      case 'page-gone':
        attached = false;
        detected = false;
        setStatus('connecting');
        return;
      case 'status':
        if (attached) return;
        if (msg.status === 'no-content-script') setStatus('reload');
        else if (msg.status === 'unreachable') setStatus('unreachable');
        return;
      case 'frame': {
        const f = msg.frame;
        if (!attached || !isAppFrame(f)) return;
        if (f.type === 'hello' || f.type === 'batch') {
          detected = true;
          setStatus('live');
        }
        deliver(f);
        return;
      }
      default:
    }
  }

  const stopPing = () => {
    if (pingTimer !== null) timers.clearInterval(pingTimer);
    pingTimer = null;
  };

  function scheduleReconnect() {
    if (closed || reconnectTimer !== null) return;
    const delay = opts.reconnectMs[Math.min(reconnects, opts.reconnectMs.length - 1)];
    reconnects++;
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  }

  function open() {
    if (closed) return;
    if (!Number.isInteger(tabId)) return setStatus('unreachable');
    let p;
    try {
      p = connect({ name: PANEL_PORT });
    } catch {
      // extension context invalidated (reloaded or removed)
      setStatus('unreachable');
      return scheduleReconnect();
    }
    port = p;
    p.onMessage.addListener((msg) => {
      if (port !== p) return;
      reconnects = 0;
      onHub(msg);
    });
    p.onDisconnect.addListener(() => {
      if (port !== p) return;
      port = null;
      attached = false;
      detected = false;
      stopPing();
      if (closed) return;
      setStatus('connecting');
      scheduleReconnect();
    });
    try {
      p.postMessage({ type: 'init', tabId });
    } catch { /* onDisconnect follows */ }
    stopPing();
    pingTimer = timers.setInterval(() => {
      try { port?.postMessage({ type: 'ping' }); } catch { /* onDisconnect follows */ }
    }, opts.pingMs);
  }

  const bridge = {
    /** @type {null | (() => void)} */
    onreset: null,
    /** @type {null | ((status: string) => void)} */
    onstatus: null,
    get onmessage() { return handler; },
    set onmessage(fn) {
      handler = typeof fn === 'function' ? fn : null;
      if (handler && !started && !closed) {
        started = true;
        open();
      }
    },
    get status() { return status; },
    get label() { return STATUS_LABELS[status] ?? status; },
    postMessage(msg) {
      if (closed || !isViewerFrame(msg)) return;
      const frame = JSON.parse(JSON.stringify(msg));
      if (attached && port) return sendFrame(frame);
      outbox.push(frame);
      if (outbox.length > opts.outboxCap) outbox.shift();
    },
    /** Navigation hint (devtools.network.onNavigated): ask the hub to re-attach now if no page is paired. */
    nudge() {
      if (port && !attached) {
        try { port.postMessage({ type: 'nudge' }); } catch { /* onDisconnect follows */ }
      }
    },
    close() {
      closed = true;
      stopPing();
      if (reconnectTimer !== null) timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      const p = port;
      port = null;
      try { p?.disconnect(); } catch { /* already gone */ }
    },
  };
  return bridge;
}
