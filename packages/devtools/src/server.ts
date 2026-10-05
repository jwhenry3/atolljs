/**
 * The local devtools server: one Node http server on 127.0.0.1 that
 *   - serves the static dashboard from ./app,
 *   - ingests instrumentation on the /events WebSocket (instrumented apps),
 *   - fans events out to /view WebSockets (open dashboards),
 *   - replays a bounded tail of recent batches to late-joining viewers.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientMessage, SessionInfo, ViewerMessage, ViewerRequest } from './protocol';
import { acceptWebSocket, type WsConnection } from './ws';
import { OtelMapper, type OtelSignals } from './otelMap';
import {
  createOtelPipeline,
  createOtlpSender,
  sessionResource,
  type OtelPipeline,
  type OtlpSenderOptions,
  type ResourceAttributes,
} from './otelTransport';

/** Forward every ingested session's events to an OTLP/HTTP endpoint. */
export interface DevtoolsServerOtlpOptions extends OtlpSenderOptions {
  /** Fixed `service.name` for every session (default: each session's name). */
  serviceName?: string;
  /** Extra resource attributes on every session. */
  resource?: ResourceAttributes;
  signals?: OtelSignals;
  /** Default 5000ms. */
  flushIntervalMs?: number;
  /** Default 512. */
  maxBatch?: number;
}

export interface DevtoolsServerOptions {
  /** Default 4780. 0 picks an ephemeral port (tests). */
  port?: number;
  /** Host — bound to loopback only; the dashboard has no auth. */
  host?: string;
  /** Static dashboard directory — defaults to the packaged app/. */
  appDir?: string;
  /** Batches kept for viewer replay (default 500). */
  replayBatches?: number;
  /** Closed-session retention before auto-cleanup (default 30min). */
  closedTtlMs?: number;
  /** How often the retention sweep runs (default 60s — tests lower it). */
  sweepMs?: number;
  /**
   * Also export everything ingested to OpenTelemetry (one OTLP resource per
   * app session). Off by default.
   */
  otlp?: DevtoolsServerOtlpOptions;
  onListen?: (url: string) => void;
}

export interface DevtoolsServer {
  readonly port: number;
  readonly url: string;
  sessions(): SessionInfo[];
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const defaultAppDir = () => fileURLToPath(new URL('../app/', import.meta.url));

const serveStatic = (appDir: string, req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (path === '' || path === '.') path = 'index.html';
  const file = join(appDir, path);
  // Prefix check against path traversal ('..' escaping the app dir).
  if (!file.startsWith(normalize(appDir)) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
};

export function createDevtoolsServer(opts: DevtoolsServerOptions = {}): Promise<DevtoolsServer> {
  const host = opts.host ?? '127.0.0.1';
  const appDir = opts.appDir ?? defaultAppDir();
  const replayCap = opts.replayBatches ?? 500;

  const viewers = new Set<WsConnection>();
  const sessions = new Map<WsConnection, SessionInfo>();
  /** Recently-disconnected sessions — bounded, kept so replayed history stays attributed. */
  const closedSessions: SessionInfo[] = [];
  const closedCap = 20;
  /** Closed sessions are evicted after this unless a viewer pinned them. */
  const closedTtlMs = opts.closedTtlMs ?? 30 * 60 * 1000;
  /** Batches kept for replay — sessions updates aren't replayed (stale). */
  const tail: ViewerMessage[] = [];
  /** In-flight control requests: request id → the viewer awaiting the result. */
  const pendingControl = new Map<string, WsConnection>();

  /** OTLP forwarding: one mapper (resource) per session id. */
  let otlp: OtelPipeline | null = null;
  const otlpSessions = new Map<string, SessionInfo>();
  if (opts.otlp) {
    const o = opts.otlp;
    otlp = createOtelPipeline({
      sender: createOtlpSender(o),
      signals: o.signals,
      flushIntervalMs: o.flushIntervalMs,
      maxBatch: o.maxBatch,
      newMapper: (id) =>
        new OtelMapper({
          resource: sessionResource(otlpSessions.get(id) ?? { id, runtime: 'browser' }, o.serviceName, o.resource),
          signals: o.signals,
        }),
    });
  }

  const sessionList = (): SessionInfo[] => [...sessions.values(), ...closedSessions];

  /** Drop a closed session and its replay tail; returns whether it existed. */
  const evictClosed = (sessionId: string): boolean => {
    const i = closedSessions.findIndex((s) => s.id === sessionId);
    if (i < 0) return false;
    closedSessions.splice(i, 1);
    for (let j = tail.length - 1; j >= 0; j--) {
      const m = tail[j];
      if (m.type === 'batch' && m.session.id === sessionId) tail.splice(j, 1);
    }
    return true;
  };

  const broadcast = (msg: ViewerMessage) => {
    if (msg.type === 'batch') {
      tail.push(msg);
      if (tail.length > replayCap) tail.shift();
    }
    const text = JSON.stringify(msg);
    for (const v of viewers) v.send(text);
  };

  const server: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
      return;
    }
    serveStatic(appDir, req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/events' && url.pathname !== '/view') {
      socket.destroy();
      return;
    }
    const conn = acceptWebSocket(req, socket);
    if (head?.length) socket.unshift(head);

    if (url.pathname === '/view') {
      viewers.add(conn);
      conn.onClose = () => {
        viewers.delete(conn);
        for (const [id, v] of pendingControl) if (v === conn) pendingControl.delete(id);
      };
      conn.onMessage = (text) => {
        let msg: ViewerRequest;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (msg.type === 'dismiss') {
          // Closed sessions only — a live app's next batch would resurrect it.
          if (evictClosed(msg.sessionId)) {
            broadcast({ type: 'sessions', sessions: sessionList() });
          }
        } else if (msg.type === 'pin') {
          const s = closedSessions.find((s) => s.id === msg.sessionId);
          if (!s || s.pinned === msg.pinned) return;
          s.pinned = msg.pinned;
          broadcast({ type: 'sessions', sessions: sessionList() });
        } else if (msg.type === 'control') {
          const app = [...sessions].find(([, s]) => s.id === msg.sessionId)?.[0];
          if (!app) {
            conn.send(JSON.stringify({
              type: 'control-result', sessionId: msg.sessionId, id: msg.id, ok: false,
              error: 'session is not live',
            } satisfies ViewerMessage));
            return;
          }
          pendingControl.set(msg.id, conn);
          app.send(JSON.stringify(msg));
        }
      };
      conn.send(JSON.stringify({ type: 'sessions', sessions: sessionList() }));
      for (const msg of tail) conn.send(JSON.stringify(msg));
      return;
    }

    // /events — an instrumented app. First frame must be hello.
    let greeted = false;
    conn.onMessage = (text) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        greeted = true;
        sessions.set(conn, msg.session);
        broadcast({ type: 'sessions', sessions: sessionList() });
        return;
      }
      if (msg.type === 'batch' && greeted) {
        const session = sessions.get(conn)!;
        broadcast({ type: 'batch', session, events: msg.events });
        if (otlp && Array.isArray(msg.events)) {
          otlpSessions.set(session.id, session);
          // Remote clocks are unknown: the mapper rebases on receive time.
          const recv = Date.now();
          for (const ev of msg.events) otlp.ingest(ev, recv, session.id);
        }
      }
      if (msg.type === 'control-result') {
        const viewer = pendingControl.get(msg.id);
        pendingControl.delete(msg.id);
        if (viewer && viewers.has(viewer)) viewer.send(JSON.stringify(msg));
      }
    };
    conn.onClose = () => {
      const info = sessions.get(conn);
      if (info && otlp) {
        otlp.release(info.id);
        otlpSessions.delete(info.id);
      }
      if (sessions.delete(conn) && info) {
        info.closed = true;
        info.closedAt = Date.now();
        closedSessions.push(info);
        if (closedSessions.length > closedCap) {
          // cap applies to unpinned sessions — pins are retained
          const i = closedSessions.findIndex((s) => !s.pinned);
          if (i >= 0) evictClosed(closedSessions[i].id);
        }
        broadcast({ type: 'sessions', sessions: sessionList() });
      }
    };
  });

  // Retention sweep — unpinned closed sessions expire after closedTtlMs.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - closedTtlMs;
    let changed = false;
    for (const s of [...closedSessions]) {
      if (!s.pinned && s.closedAt !== undefined && s.closedAt < cutoff) {
        changed = evictClosed(s.id) || changed;
      }
    }
    if (changed) broadcast({ type: 'sessions', sessions: sessionList() });
  }, opts.sweepMs ?? 60_000);
  sweep.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 4780, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : (opts.port ?? 4780);
      const url = `http://${host}:${port}`;
      opts.onListen?.(url);
      resolve({
        port,
        url,
        sessions: () => [...sessions.values()],
        close: () =>
          new Promise<void>((done) => {
            clearInterval(sweep);
            for (const v of viewers) v.close();
            for (const c of sessions.keys()) c.close();
            server.close(() => {
              if (otlp) void otlp.close().then(() => done());
              else done();
            });
          }),
      });
    });
  });
}
