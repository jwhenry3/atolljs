/**
 * The instrumented-app side: `connectDevtools()` installs the core event
 * sink and batches events to dashboards. Two transports:
 *
 *   connectDevtools()                    // auto — BroadcastChannel in a
 *                                        // browser (pure client), else ws
 *   connectDevtools({ url })             // explicit aggregate server
 *   connectDevtools({ transport: 'websocket' })   // server, default url
 *
 * BroadcastChannel mode needs no backend: the dashboard is served on the
 * app's own origin (vite plugin mounts it at /__atoll/) and listens on
 * the same channel — origin scoping is the isolation. WebSocket mode
 * targets the standalone aggregate server (`atoll devtools`, default
 * ws://127.0.0.1:4780/events) — opt-in for cross-app views and Node.
 *
 * Events emitted while a socket is still connecting are buffered; the
 * buffer is bounded so an app that runs without a listener doesn't grow
 * memory unboundedly.
 */
import {
  installFetchProbe,
  installMemoryProbe,
  setDevtoolsSink,
  type EmittedDevtoolsEvent,
} from '@atolljs/core';
import { connectBroadcast } from './broadcast';
import { answerControl, captureEnv } from './control';
import { installJankProbe } from './probes';
import type { AppMessage, ClientMessage, SessionInfo } from './protocol';

export interface ConnectDevtoolsOptions {
  /**
   * Transport. Default `'auto'`: BroadcastChannel in a browser window
   * (pure client — dashboards open on the app's own origin via /__atoll/),
   * WebSocket everywhere else (Node, workers, non-BC browsers).
   * `'websocket'` or setting `url` opts into the aggregate server.
   */
  transport?: 'auto' | 'broadcast' | 'websocket';
  /** Server ingest endpoint — implies websocket transport. */
  url?: string;
  /** Session identity shown in the dashboard. */
  session?: { name?: string; hint?: string; framework?: string };
  /** Batch flush interval ms (default 100). */
  flushMs?: number;
  /** Events buffered while disconnected (default 50_000 — oldest dropped). */
  bufferCap?: number;
  /** Batches kept for replay to late-joining dashboards (broadcast, default 500). */
  replayBatches?: number;
  /** Patch global fetch to log requests (default true). Worker fetch is probed via the pool's devtools INIT flag. */
  network?: boolean;
  /** Sample JS heap usage periodically — Chrome/Blink only (default true). */
  memory?: boolean;
  /**
   * Main-thread jank probe (default true): long frames (`runtime:longframe`,
   * Long Animation Frames or `longtask`) and a rAF fps sampler
   * (`runtime:frames`). Browser main thread only.
   */
  jank?: boolean;
}

export interface DevtoolsConnection {
  readonly open: boolean;
  readonly session: SessionInfo;
  /** Uninstall the sink and close the socket. */
  close(): void;
}

let sessionSeq = 0;

const makeSession = (opts: ConnectDevtoolsOptions): SessionInfo => {
  const runtime: SessionInfo['runtime'] =
    typeof window !== 'undefined' && typeof window.document !== 'undefined' ? 'browser' : 'node';
  const hint =
    opts.session?.hint ??
    (runtime === 'browser'
      ? (globalThis as { location?: { href?: string } }).location?.href
      : (globalThis as { process?: { title?: string } }).process?.title);
  return {
    id: `s-${Date.now().toString(36)}-${++sessionSeq}`,
    name: opts.session?.name,
    framework: opts.session?.framework,
    runtime,
    hint,
    env: captureEnv(),
  };
};

/** 'auto' picks broadcast only in a real browser window — workers and
 *  Node contexts keep the aggregate-server path. An explicit
 *  `transport: 'broadcast'` is honored wherever BroadcastChannel exists
 *  (SharedWorkers have no window but can still be pure-client hubs). */
const autoBroadcast = () =>
  typeof BroadcastChannel !== 'undefined' &&
  typeof window !== 'undefined' &&
  typeof window.document !== 'undefined';

export function connectDevtools(opts: ConnectDevtoolsOptions = {}): DevtoolsConnection {
  const session = makeSession(opts);
  const t = opts.url !== undefined ? 'websocket' : (opts.transport ?? 'auto');
  const useBc =
    t === 'broadcast'
      ? typeof BroadcastChannel !== 'undefined'
      : t === 'auto' && autoBroadcast();
  return useBc ? connectBroadcast(opts, session) : connectWebSocket(opts, session);
}

function connectWebSocket(opts: ConnectDevtoolsOptions, session: SessionInfo): DevtoolsConnection {
  const url = opts.url ?? 'ws://127.0.0.1:4780/events';
  const cap = opts.bufferCap ?? 50_000;
  const pending: EmittedDevtoolsEvent[] = [];
  let closed = false;

  /** Uniform socket surface over the global WebSocket and the Node fallback. */
  let sock: { open: boolean; send(text: string): void; close(): void } | null = null;

  const send = (msg: ClientMessage) => {
    if (sock?.open) sock.send(JSON.stringify(msg));
  };

  const flush = () => {
    if (!sock?.open || pending.length === 0) return;
    const events = pending.splice(0, pending.length);
    send({ type: 'batch', events });
  };

  const onOpen = () => {
    send({ type: 'hello', session });
    flush();
  };

  const onMessage = (text: string) => {
    let msg: AppMessage;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === 'control') void answerControl(msg, (res) => send(res));
  };

  const isNode = typeof window === 'undefined' || typeof window.document === 'undefined';
  if (typeof WebSocket !== 'undefined') {
    const ws = new WebSocket(url);
    sock = {
      get open() {
        return ws.readyState === ws.OPEN;
      },
      send: (t) => ws.send(t),
      close: () => ws.close(),
    };
    ws.onopen = onOpen;
    ws.onmessage = (m: MessageEvent) => onMessage(String(m.data));
    ws.onclose = () => clearInterval(timer);
    ws.onerror = () => ws.close();
  } else if (isNode) {
    // No global WebSocket (Node < 22) — dependency-free client, loaded lazily
    // so node:net/crypto never enter a browser bundle. The specifier is
    // computed: a literal would pull nodeWs.ts (and its node:* imports)
    // into browser-app tsconfig programs and vite's static analysis.
    const mod = './nodeWs.ts';
    void import(/* @vite-ignore */ mod).then((m) => {
      if (closed) return;
      const ws = m.connectNodeWebSocket(url);
      sock = ws;
      ws.onOpen = onOpen;
      ws.onMessage = onMessage;
      ws.onClose = () => clearInterval(timer);
    }).catch(() => {
      /* no net available — sink stays installed but dead */
    });
  }

  const timer = setInterval(flush, opts.flushMs ?? 100);
  // Node: don't hold the process open for the flush interval.
  (timer as unknown as { unref?: () => void }).unref?.();

  if (opts.network !== false) installFetchProbe(globalThis);
  if (opts.memory !== false) installMemoryProbe(globalThis);
  const releaseJank = opts.jank !== false ? installJankProbe() : () => {};

  setDevtoolsSink((event) => {
    if (closed) return;
    pending.push(event);
    if (pending.length > cap) pending.shift();
    if (pending.length >= 1000) flush(); // large bursts flush early
  });

  return {
    session,
    get open() {
      return sock?.open ?? false;
    },
    close() {
      closed = true;
      setDevtoolsSink(null);
      flush();
      sock?.close();
      clearInterval(timer);
      releaseJank();
    },
  };
}
