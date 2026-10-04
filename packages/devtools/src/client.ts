/**
 * The instrumented-app side: `connectDevtools()` installs the core event
 * sink and batches events over a WebSocket to the local devtools server
 * (`atoll devtools` / `atoll-devtools`). Works identically in the browser
 * and in Node ≥22 (global WebSocket) — pool events from `worker_threads`
 * reach it through the same ATOLL_DEVTOOLS forwarding.
 *
 *   import { connectDevtools } from '@atolljs/devtools';
 *   connectDevtools();                       // ws://127.0.0.1:4780/events
 *
 * Events emitted while the socket is still connecting are buffered; the
 * buffer is bounded so an app that runs without the server doesn't grow
 * memory unboundedly.
 */
import {
  installFetchProbe,
  installMemoryProbe,
  setDevtoolsSink,
  type EmittedDevtoolsEvent,
} from '@atolljs/core';
import type { ClientMessage, SessionInfo } from './protocol';

export interface ConnectDevtoolsOptions {
  /** Server ingest endpoint — default ws://127.0.0.1:4780/events. */
  url?: string;
  /** Session identity shown in the dashboard. */
  session?: { name?: string; hint?: string };
  /** Batch flush interval ms (default 100). */
  flushMs?: number;
  /** Events buffered while disconnected (default 50_000 — oldest dropped). */
  bufferCap?: number;
  /** Patch global fetch to log requests (default true). Worker fetch is probed via the pool's devtools INIT flag. */
  network?: boolean;
  /** Sample JS heap usage periodically — Chrome/Blink only (default true). */
  memory?: boolean;
}

export interface DevtoolsConnection {
  readonly open: boolean;
  readonly session: SessionInfo;
  /** Uninstall the sink and close the socket. */
  close(): void;
}

let sessionSeq = 0;

export function connectDevtools(opts: ConnectDevtoolsOptions = {}): DevtoolsConnection {
  const url = opts.url ?? 'ws://127.0.0.1:4780/events';
  const runtime: SessionInfo['runtime'] =
    typeof window !== 'undefined' && typeof window.document !== 'undefined' ? 'browser' : 'node';
  const hint =
    opts.session?.hint ??
    (runtime === 'browser'
      ? (globalThis as { location?: { href?: string } }).location?.href
      : (globalThis as { process?: { title?: string } }).process?.title);
  const session: SessionInfo = {
    id: `s-${Date.now().toString(36)}-${++sessionSeq}`,
    name: opts.session?.name,
    runtime,
    hint,
  };

  const cap = opts.bufferCap ?? 50_000;
  const pending: EmittedDevtoolsEvent[] = [];
  let ws: WebSocket | null = null;
  let closed = false;

  const send = (msg: ClientMessage) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const flush = () => {
    if (!ws || ws.readyState !== ws.OPEN || pending.length === 0) return;
    const events = pending.splice(0, pending.length);
    send({ type: 'batch', events });
  };

  try {
    ws = new WebSocket(url);
  } catch {
    ws = null; // no WebSocket global — sink stays installed but dead; close() cleans up
  }
  if (ws) {
    ws.onopen = () => {
      send({ type: 'hello', session });
      flush();
    };
    const timer = setInterval(flush, opts.flushMs ?? 100);
    // Node: don't hold the process open for the flush interval.
    (timer as unknown as { unref?: () => void }).unref?.();
    ws.onclose = () => clearInterval(timer);
    ws.onerror = () => ws?.close();
  }

  if (opts.network !== false) installFetchProbe(globalThis);
  if (opts.memory !== false) installMemoryProbe(globalThis);

  setDevtoolsSink((event) => {
    if (closed) return;
    pending.push(event);
    if (pending.length > cap) pending.shift();
    if (pending.length >= 1000) flush(); // large bursts flush early
  });

  return {
    session,
    get open() {
      return ws?.readyState === ws?.OPEN;
    },
    close() {
      closed = true;
      setDevtoolsSink(null);
      flush();
      ws?.close();
    },
  };
}
