// Service worker routing, transport-free so it tests in Node: background.js
// plugs in chrome.runtime and chrome.tabs.
//
// Panels connect an 'atoll-panel' port and send {type: 'init', tabId}. The
// hub then asks that tab's top-frame content script to attach
// (tabs.sendMessage {type: 'atoll-attach'}), which connects back on an
// 'atoll-page' port. Frames are relayed both ways and shape-checked here,
// the trust boundary between page data and the extension.
//
// hub -> panel messages:
//   {type: 'attached'}         a page port paired (first time for this panel)
//   {type: 'reset'}            a NEW page port paired after an earlier one (navigation)
//   {type: 'page-gone'}        the page port dropped; re-attach is being retried
//   {type: 'status', status}   attach failed: 'no-content-script' | 'unreachable'
//   {type: 'frame', frame}     an app frame (hello, batch, bye, control-result)
// panel -> hub messages:
//   {type: 'init', tabId}  {type: 'frame', frame}  {type: 'nudge'}  {type: 'ping'}
import { ATTACH, PAGE_PORT, PANEL_PORT, isAppFrame, isViewerFrame } from './frames.js';

export const HUB_DEFAULTS = {
  /** Re-attach delays after a page port drops or an attach fails, then `slowMs` forever. */
  retryMs: [200, 500, 1000, 2000],
  slowMs: 3000,
};

const NO_RECEIVER = /receiving end does not exist|could not establish connection/i;

/**
 * @param {{
 *   runtime: { onConnect: { addListener: (fn: (port: any) => void) => void } },
 *   tabs: { sendMessage: (tabId: number, msg: unknown, opts: { frameId: number }) => Promise<any> },
 *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout },
 *   options?: Partial<typeof HUB_DEFAULTS>,
 * }} deps
 */
export function createHub({ runtime, tabs, timers = globalThis, options = {} }) {
  const opts = { ...HUB_DEFAULTS, ...options };
  /** tabId -> { tabId, panels: Map<port, { paired: boolean }>, page, timer, attempt, status, quiet } */
  const entries = new Map();

  const send = (port, msg) => {
    try { port.postMessage(msg); } catch { /* port closing; its onDisconnect cleans up */ }
  };
  const toPanels = (entry, msg) => { for (const p of entry.panels.keys()) send(p, msg); };

  const reportStatus = (entry, status) => {
    if (entry.status === status) return;
    entry.status = status;
    toPanels(entry, { type: 'status', status });
  };

  const schedule = (tabId, entry) => {
    if (entry.timer !== null) timers.clearTimeout(entry.timer);
    const delay = opts.retryMs[entry.attempt] ?? opts.slowMs;
    entry.attempt++;
    entry.timer = timers.setTimeout(() => {
      entry.timer = null;
      tryAttach(tabId, entry);
    }, delay);
  };

  // No receiver: the page predates the install, or it's one no content script
  // runs on (chrome://, the Web Store). Without the `tabs` permission the hub
  // can't read the tab URL to tell those apart.
  const classify = (err) => (NO_RECEIVER.test(String(err?.message ?? err)) ? 'no-content-script' : 'unreachable');

  const tryAttach = (tabId, entry) => {
    if (entry.page || !entry.panels.size || entries.get(tabId) !== entry) return;
    const live = () => !entry.page && entry.panels.size > 0 && entries.get(tabId) === entry;
    let sent;
    try {
      sent = Promise.resolve(tabs.sendMessage(tabId, { type: ATTACH }, { frameId: 0 }));
    } catch (err) {
      sent = Promise.reject(err);
    }
    sent.then(
      (res) => {
        if (!live()) return;
        if (!res?.ok) reportStatus(entry, 'unreachable');
        // the page port normally connects before this resolves; keep retrying until it pairs
        schedule(tabId, entry);
      },
      (err) => {
        const status = classify(err);
        if (!live()) return;
        // mid-navigation the new document's script may not exist yet: stay quiet through the fast retries
        if (!entry.quiet || entry.attempt >= opts.retryMs.length) reportStatus(entry, status);
        schedule(tabId, entry);
      },
    );
  };

  const restartAttach = (tabId, entry, quiet) => {
    if (entry.timer !== null) timers.clearTimeout(entry.timer);
    entry.timer = null;
    entry.attempt = 0;
    entry.quiet = quiet;
    tryAttach(tabId, entry);
  };

  function onPanel(port) {
    let tabId = null;
    const leave = () => {
      if (tabId === null) return;
      const entry = entries.get(tabId);
      tabId = null;
      if (!entry) return;
      entry.panels.delete(port);
      if (entry.panels.size) return;
      if (entry.timer !== null) timers.clearTimeout(entry.timer);
      entries.delete(entry.tabId);
      // the content script goes passive on disconnect
      try { entry.page?.disconnect(); } catch { /* already gone */ }
    };
    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'init' && Number.isInteger(msg.tabId)) {
        if (tabId === msg.tabId) return;
        leave();
        tabId = msg.tabId;
        let entry = entries.get(tabId);
        if (!entry) {
          entry = { tabId, panels: new Map(), page: null, timer: null, attempt: 0, status: null, quiet: false };
          entries.set(tabId, entry);
        }
        entry.panels.set(port, { paired: !!entry.page });
        if (entry.page) send(port, { type: 'attached' });
        else if (entry.status) send(port, { type: 'status', status: entry.status });
        if (!entry.page && entry.panels.size === 1) restartAttach(tabId, entry, false);
        return;
      }
      if (tabId === null) return;
      const entry = entries.get(tabId);
      if (!entry) return;
      if (msg.type === 'frame') {
        if (entry.page && isViewerFrame(msg.frame)) send(entry.page, msg.frame);
      } else if (msg.type === 'nudge') {
        if (!entry.page) restartAttach(tabId, entry, true);
      }
      // 'ping' is a keepalive: receiving it is the point
    });
    port.onDisconnect.addListener(leave);
  }

  function onPage(port) {
    const tabId = port.sender?.tab?.id;
    const entry = Number.isInteger(tabId) ? entries.get(tabId) : undefined;
    if (!entry || port.sender?.frameId !== 0 || !entry.panels.size) {
      try { port.disconnect(); } catch { /* already gone */ }
      return;
    }
    const prev = entry.page;
    entry.page = port;
    if (entry.timer !== null) timers.clearTimeout(entry.timer);
    entry.timer = null;
    entry.attempt = 0;
    entry.status = null;
    if (prev) { try { prev.disconnect(); } catch { /* already gone */ } }
    for (const [panel, st] of entry.panels) {
      send(panel, { type: st.paired ? 'reset' : 'attached' });
      st.paired = true;
    }
    port.onMessage.addListener((frame) => {
      if (entry.page !== port || !isAppFrame(frame)) return;
      toPanels(entry, { type: 'frame', frame });
    });
    port.onDisconnect.addListener(() => {
      if (entry.page !== port) return;
      entry.page = null;
      if (!entry.panels.size || entries.get(tabId) !== entry) return;
      toPanels(entry, { type: 'page-gone' });
      restartAttach(tabId, entry, true);
    });
  }

  runtime.onConnect.addListener((port) => {
    if (port.name === PANEL_PORT) onPanel(port);
    else if (port.name === PAGE_PORT) onPage(port);
  });

  return {
    /** Introspection for tests: tabs with a panel attached, and whether each has a page port. */
    get tabs() {
      return [...entries.values()].map((e) => ({ tabId: e.tabId, panels: e.panels.size, page: !!e.page }));
    },
  };
}
