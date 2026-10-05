// Content script (ISOLATED world, top frame, document_start). Passive until
// the hub asks: loading a page only registers a runtime.onMessage listener,
// which opens no port, joins no channel and doesn't wake the service worker.
//
// On {type: 'atoll-attach'} it connects an 'atoll-page' port and joins the
// page's BroadcastChannel('atoll-devtools') (an isolated world shares the
// document's origin, so it hears the app), then pushes each app frame to
// the port as it arrives and posts viewer frames from the port onto the
// channel. When the port drops (panel closed, service worker restarted,
// page entering the back/forward cache) the channel closes and the script
// is passive again.
//
// Manifest content scripts can't be ES modules: scripts/build.mjs inlines
// frames.js and this file into dist/content.js, stripping import/export.
import { ATTACH, CHANNEL, PAGE_PORT, isAppFrame, isViewerFrame } from './frames.js';

/**
 * @param {{
 *   runtime: {
 *     connect: (info: { name: string }) => any,
 *     onMessage: { addListener: (fn: (msg: any, sender: any, sendResponse: (r: unknown) => void) => unknown) => void },
 *   },
 *   BroadcastChannel?: typeof BroadcastChannel,
 * }} deps
 */
export function installContentRelay({ runtime, BroadcastChannel: Channel = globalThis.BroadcastChannel }) {
  let port = null;
  let bc = null;

  const release = () => {
    try { bc?.close(); } catch { /* already closed */ }
    bc = null;
    port = null;
  };

  const attach = () => {
    if (port) return true;
    let ch;
    try { ch = new Channel(CHANNEL); } catch { return false; }
    let p;
    try {
      p = runtime.connect({ name: PAGE_PORT });
    } catch {
      // extension reloaded or removed: this script's context is orphaned
      ch.close();
      return false;
    }
    port = p;
    bc = ch;
    ch.onmessage = (e) => {
      if (port !== p || !isAppFrame(e.data)) return;
      // Chrome serializes port messages as JSON: a frame that can't be is dropped
      try { p.postMessage(e.data); } catch { /* unserializable or port closing */ }
    };
    p.onMessage.addListener((m) => {
      if (port !== p || !isViewerFrame(m)) return;
      try { ch.postMessage(m); } catch { /* channel closing */ }
    });
    p.onDisconnect.addListener(() => { if (port === p) release(); });
    return true;
  };

  runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== ATTACH) return undefined;
    sendResponse({ ok: attach() });
    return undefined;
  });

  return {
    get attached() { return port !== null; },
    get channelOpen() { return bc !== null; },
  };
}
