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

export interface DevtoolsServerOptions {
  /** Default 4780. 0 picks an ephemeral port (tests). */
  port?: number;
  /** Host — bound to loopback only; the dashboard has no auth. */
  host?: string;
  /** Static dashboard directory — defaults to the packaged app/. */
  appDir?: string;
  /** Batches kept for viewer replay (default 500). */
  replayBatches?: number;
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
  /** Batches kept for replay — sessions updates aren't replayed (stale). */
  const tail: ViewerMessage[] = [];

  const sessionList = (): SessionInfo[] => [...sessions.values(), ...closedSessions];

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
      conn.onClose = () => viewers.delete(conn);
      conn.onMessage = (text) => {
        let msg: ViewerRequest;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (msg.type === 'dismiss') {
          // Closed sessions only — a live app's next batch would resurrect it.
          const i = closedSessions.findIndex((s) => s.id === msg.sessionId);
          if (i < 0) return;
          closedSessions.splice(i, 1);
          for (let j = tail.length - 1; j >= 0; j--) {
            const m = tail[j];
            if (m.type === 'batch' && m.session.id === msg.sessionId) tail.splice(j, 1);
          }
          broadcast({ type: 'sessions', sessions: sessionList() });
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
        broadcast({ type: 'batch', session: sessions.get(conn)!, events: msg.events });
      }
    };
    conn.onClose = () => {
      const info = sessions.get(conn);
      if (sessions.delete(conn) && info) {
        info.closed = true;
        closedSessions.push(info);
        if (closedSessions.length > closedCap) closedSessions.shift();
        broadcast({ type: 'sessions', sessions: sessionList() });
      }
    };
  });

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
            for (const v of viewers) v.close();
            for (const c of sessions.keys()) c.close();
            server.close(() => done());
          }),
      });
    });
  });
}
