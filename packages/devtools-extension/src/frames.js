// Shared vocabulary of the push relay: channel and port names, the
// hub <-> panel message types, and the frame shape checks every hop runs.
// No chrome.* here; the content script build inlines this file.

/** Channel name, mirrors DEVTOOLS_CHANNEL in packages/devtools/src/protocol.ts. */
export const CHANNEL = 'atoll-devtools';
/** runtime.connect port names. */
export const PANEL_PORT = 'atoll-panel';
export const PAGE_PORT = 'atoll-page';
/** tabs.sendMessage payload that wakes a passive content script. */
export const ATTACH = 'atoll-attach';
/** App -> viewer frame types (the rest of BroadcastMessage is viewer -> app). */
export const APP_FRAME_TYPES = ['hello', 'batch', 'bye', 'control-result'];

const isSession = (s) => !!s && typeof s === 'object' && typeof s.id === 'string';

/** Shape check on page data before it reaches the dashboard (the page controls it). */
export function isAppFrame(m) {
  if (!m || typeof m !== 'object') return false;
  switch (m.type) {
    case 'hello': return isSession(m.session);
    case 'batch': return isSession(m.session) && Array.isArray(m.events);
    case 'bye': return typeof m.sessionId === 'string';
    case 'control-result': return typeof m.sessionId === 'string' && typeof m.id === 'string' && typeof m.ok === 'boolean';
    default: return false;
  }
}

/** Viewer -> app frames the panel may post on the page's channel. */
export function isViewerFrame(m) {
  if (!m || typeof m !== 'object') return false;
  if (m.type === 'view') return true;
  return m.type === 'control' && typeof m.sessionId === 'string' && typeof m.id === 'string' && typeof m.cmd === 'string';
}
