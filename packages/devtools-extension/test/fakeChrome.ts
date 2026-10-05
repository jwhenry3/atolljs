/**
 * In-memory stand-ins for the chrome.* messaging surface the extension uses:
 * runtime ports (JSON-serialized like Chrome, async delivery, disconnect
 * fires only at the other end), runtime.onConnect for the hub,
 * tabs.sendMessage with Chrome's "Receiving end does not exist" rejection,
 * and per-tab content-script runtimes.
 */
import { vi } from 'vitest';
import { installContentRelay } from '../src/content.js';

type Fn = (...args: any[]) => unknown;

export class FakeEvent {
  listeners = new Set<Fn>();
  addListener(fn: Fn) { this.listeners.add(fn); }
  removeListener(fn: Fn) { this.listeners.delete(fn); }
  emit(...args: unknown[]) { for (const fn of [...this.listeners]) fn(...args); }
}

export interface FakePort {
  name: string;
  sender?: { tab?: { id: number }; frameId?: number };
  onMessage: FakeEvent;
  onDisconnect: FakeEvent;
  connected: boolean;
  sent: unknown[];
  postMessage(msg: unknown): void;
  disconnect(): void;
  /** Test helper: the context holding this end went away (document unload). */
  vanish(): void;
}

/** Two linked port ends; `sender` is what the far (receiving) end reports. */
export function portPair(name: string, sender?: FakePort['sender']): [FakePort, FakePort] {
  const make = (s?: FakePort['sender']): FakePort => ({
    name, sender: s, onMessage: new FakeEvent(), onDisconnect: new FakeEvent(), connected: true, sent: [],
    postMessage(msg) {
      if (!this.connected) throw new Error('Attempting to use a disconnected port object');
      const copy = JSON.parse(JSON.stringify(msg)); // throws on BigInt, like Chrome's JSON serialization
      this.sent.push(copy);
      queueMicrotask(() => { if (other(this).connected) other(this).onMessage.emit(copy, other(this)); });
    },
    disconnect() {
      if (!this.connected) return;
      this.connected = false;
      other(this).connected = false;
      queueMicrotask(() => other(this).onDisconnect.emit(other(this)));
    },
    vanish() {
      if (!this.connected) return;
      this.disconnect();
      queueMicrotask(() => this.onDisconnect.emit(this));
    },
  });
  const a = make();
  const b = make(sender);
  const other = (p: FakePort) => (p === a ? b : a);
  return [a, b];
}

export const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';

export function createFakeChrome() {
  const onConnect = new FakeEvent();
  /** tabId -> content-script runtime (absent: page loaded before install / restricted). */
  const pages = new Map<number, ReturnType<typeof contentRuntime>>();
  let sendError: string | null = null;

  function contentRuntime(tabId: number, frameId: number) {
    const onMessage = new FakeEvent();
    const ports: FakePort[] = [];
    return {
      onMessage,
      ports,
      connect({ name }: { name: string }) {
        const [mine, theirs] = portPair(name, { tab: { id: tabId }, frameId });
        ports.push(mine);
        queueMicrotask(() => onConnect.emit(theirs));
        return mine;
      },
    };
  }

  const chrome = {
    runtime: { onConnect },
    tabs: {
      sendMessage: vi.fn(async (tabId: number, msg: unknown, opts: { frameId: number }) => {
        await Promise.resolve();
        if (sendError) throw new Error(sendError);
        const page = pages.get(tabId);
        if (!page || opts?.frameId !== 0) throw new Error(NO_RECEIVER);
        let response: unknown;
        let responded = false;
        page.onMessage.emit(msg, { id: 'ext' }, (r: unknown) => { responded = true; response = r; });
        if (!responded) throw new Error('The message port closed before a response was received.');
        return JSON.parse(JSON.stringify(response));
      }),
    },
  };

  return {
    chrome,
    pages,
    /** Load a document in `tabId` whose top-frame content script uses the given BroadcastChannel. */
    load(tabId: number, opts: { BroadcastChannel?: typeof BroadcastChannel } = {}) {
      const rt = contentRuntime(tabId, 0);
      pages.set(tabId, rt);
      const relay = installContentRelay({ runtime: rt, ...opts });
      return { rt, relay };
    },
    /** The document in `tabId` unloads: its ports vanish, its content script is gone. */
    unload(tabId: number) {
      const rt = pages.get(tabId);
      pages.delete(tabId);
      for (const p of rt?.ports ?? []) p.vanish();
    },
    /** A port from some other frame/tab context straight to the hub. */
    connectFrom(name: string, sender?: FakePort['sender']) {
      const [mine, theirs] = portPair(name, sender);
      queueMicrotask(() => onConnect.emit(theirs));
      return mine;
    },
    /** What a DevTools panel page's chrome.runtime.connect does. */
    connectPanel: vi.fn((info: { name: string }) => {
      const [mine, theirs] = portPair(info.name, {});
      queueMicrotask(() => onConnect.emit(theirs));
      return mine;
    }),
    failSends(message: string | null) { sendError = message; },
  };
}
