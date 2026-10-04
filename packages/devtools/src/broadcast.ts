/**
 * Pure-client transport: instead of a WebSocket to a devtools server, the
 * app publishes session/hello/batch/bye frames on a same-origin
 * BroadcastChannel. Dashboards open on the app's own origin (the vite
 * plugin serves the dashboard at /__atoll/) and listen on the same
 * channel — so a dashboard can only ever see apps on its own origin, and
 * no backend process is involved at all.
 *
 * Late-joining dashboards post { type: 'view' }; the app re-hellos and
 * replays a bounded tail of recent batches so the view isn't empty.
 */
import {
  installFetchProbe,
  installMemoryProbe,
  setDevtoolsSink,
  type EmittedDevtoolsEvent,
} from '@atolljs/core';
import { DEVTOOLS_CHANNEL, type BroadcastMessage, type SessionInfo } from './protocol';
import type { ConnectDevtoolsOptions, DevtoolsConnection } from './client';

export function connectBroadcast(
  opts: ConnectDevtoolsOptions,
  session: SessionInfo,
): DevtoolsConnection {
  const bc = new BroadcastChannel(DEVTOOLS_CHANNEL);
  const cap = opts.bufferCap ?? 50_000;
  const tailCap = opts.replayBatches ?? 500;
  const pending: EmittedDevtoolsEvent[] = [];
  /** Batches kept for replay to late-joining dashboards. */
  const tail: EmittedDevtoolsEvent[][] = [];
  let closed = false;

  const post = (msg: BroadcastMessage) => {
    try {
      bc.postMessage(msg);
    } catch {
      // channel torn down — close() races with postMessage on some engines
    }
  };

  const hello = () => post({ type: 'hello', session });

  const flush = () => {
    if (closed || pending.length === 0) return;
    const events = pending.splice(0, pending.length);
    tail.push(events);
    if (tail.length > tailCap) tail.shift();
    post({ type: 'batch', session, events });
  };

  // A dashboard announcing itself — re-identify and replay so it doesn't
  // start empty. The app listens on the same channel it publishes on.
  bc.onmessage = (m: MessageEvent<BroadcastMessage>) => {
    if (m.data?.type === 'view') {
      hello();
      for (const events of tail) post({ type: 'batch', session, events });
    }
  };

  const timer = setInterval(flush, opts.flushMs ?? 100);
  (timer as unknown as { unref?: () => void }).unref?.();

  const bye = () => {
    flush();
    post({ type: 'bye', sessionId: session.id });
  };
  const onHide = () => bye();
  if (typeof addEventListener === 'function') addEventListener('pagehide', onHide);

  if (opts.network !== false) installFetchProbe(globalThis);
  if (opts.memory !== false) installMemoryProbe(globalThis);

  setDevtoolsSink((event) => {
    if (closed) return;
    pending.push(event);
    if (pending.length > cap) pending.shift();
    if (pending.length >= 1000) flush();
  });

  hello();

  return {
    session,
    get open() {
      return !closed;
    },
    close() {
      if (closed) return;
      closed = true;
      bye();
      setDevtoolsSink(null);
      clearInterval(timer);
      if (typeof removeEventListener === 'function') removeEventListener('pagehide', onHide);
      bc.close();
    },
  };
}
