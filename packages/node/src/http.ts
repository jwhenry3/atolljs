// HTTP clustering for plain-Node servers — the worker_threads answer to the
// cluster module. The main thread accepts TCP connections with
// pauseOnConnect (no bytes consumed) and transfers each net.Socket to a
// pool worker via postMessage. The worker feeds it into its own
// http.Server, so request parsing, route handling, and response
// serialization ALL run off the API thread — the main thread only moves a
// handle. Works alongside task dispatch: the same workers still answer
// EXECUTE_TASK; sockets just queue behind whatever a worker is doing.
import {
  createServer as createHttpServer,
  request as httpRequest,
  Server as HttpServer,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from 'node:http';
import {
  connect as netConnect,
  createServer as createNetServer,
  type Server as NetServer,
  type Socket,
} from 'node:net';
import { isMainThread, parentPort } from 'node:worker_threads';

/** Wire id for transferred sockets — distinct from the pool's task protocol. */
const HTTP_CONNECTION = 'HTTP_CONNECTION';
/** Wire id a worker uses to announce an internally-listening HTTP port. */
export const HTTP_PORT = 'HTTP_PORT';
/** Wire id a tracker sends to re-request an HTTP_PORT announcement. */
const HTTP_PORT_QUERY = 'HTTP_PORT_QUERY';

/**
 * net.Socket/net.Server handles only became transferable across
 * worker_threads in Node.js 26 — on older runtimes postMessage throws
 * DataCloneError ("Found invalid value in transferList"). Gate at setup so
 * the failure is loud instead of dropping connections.
 */
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
export const SOCKET_TRANSFER_SUPPORTED = NODE_MAJOR >= 26;

function assertSocketTransferSupported(): void {
  if (!SOCKET_TRANSFER_SUPPORTED) {
    throw new Error(
      `serveHttp (without { listen }) requires Node.js >= 26 for net.Socket transfer ` +
        `across worker_threads (found ${process.versions.node}).`,
    );
  }
}

/** Anything that exposes its workers — WorkerPool is the usual source. */
export interface WorkerSource {
  readonly workers: readonly Worker[];
}

export interface HttpClusterOptions {
  /** The pool whose workers serve connections (respawns picked up on read). */
  pool: WorkerSource;
  /** Port to listen on. Ignored when `server` is provided. */
  port?: number;
  /** Listen host. Ignored when `server` is provided. */
  host?: string;
  /**
   * Bring your own listener — MUST be created with `pauseOnConnect: true`
   * (e.g. `net.createServer({ pauseOnConnect: true })`) or the main thread
   * may consume request bytes before the socket is transferred.
   */
  server?: NetServer;
  /**
   * Connection → worker selection. Defaults to round-robin. Receives the
   * fresh `pool.workers` snapshot each call, so respawns participate.
   * Returning undefined destroys the socket.
   */
  route?: (socket: Socket, workers: readonly Worker[]) => Worker | undefined;
  /** Called once the server is listening. */
  onListen?: (server: NetServer) => void;
}

export interface HttpCluster {
  /** The listening TCP server (the user's `server` when provided). */
  server: NetServer;
  /** Stop accepting; in-flight transferred connections stay with workers. */
  close(): Promise<void>;
}

/**
 * Main thread: cluster a pool behind one listener — accept connections and
 * hand each socket to a pool worker. Pairs with the worker-side
 * {@link serveHttp}:
 *
 *   const pool = createNodePool({ worker: () => new Worker(new URL('./api.worker.js', import.meta.url)), sharedMemory, poolSize: 'auto' });
 *   const cluster = createHttpCluster({ pool, port: 8080 }); // null below Node 26
 *
 * Sockets transfer BEFORE any bytes are read — the worker's http.Server does
 * all parsing. HTTPS termination is not supported here (the TLS handshake
 * would run on the accept thread); terminate TLS upstream or serve plain
 * HTTP behind a proxy.
 *
 * Returns `null` on runtimes without socket transfer (Node < 26 — see
 * {@link SOCKET_TRANSFER_SUPPORTED}) after logging a one-line notice, so
 * callers can write the cluster unconditionally and degrade to gateway-only
 * behavior without wrapping the call in capability checks.
 */
export function createHttpCluster(options: HttpClusterOptions): HttpCluster | null {
  if (!SOCKET_TRANSFER_SUPPORTED) {
    console.warn(
      `[atoll] createHttpCluster skipped — net.Socket transfer requires Node.js >= 26 ` +
        `(found ${process.versions.node})`,
    );
    return null;
  }
  let cursor = 0;
  const route =
    options.route ??
    ((_: Socket, workers: readonly Worker[]) =>
      workers.length === 0 ? undefined : workers[cursor++ % workers.length]);

  const server = options.server ?? createNetServer({ pauseOnConnect: true });
  server.on('connection', (socket: Socket) => {
    const worker = route(socket, options.pool.workers);
    if (!worker) {
      socket.destroy();
      return;
    }
    try {
      worker.postMessage({ type: HTTP_CONNECTION, socket }, [
        socket as unknown as Transferable,
      ]);
    } catch (err) {
      socket.destroy();
      server.emit('error', err);
    }
  });
  if (!options.server) {
    server.listen(options.port ?? 8080, options.host, () => options.onListen?.(server));
  } else {
    options.onListen?.(server);
  }
  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

export interface ServeHttpOptions {
  /**
   * Listen on an internal TCP port and announce it to the parent thread via
   * a `{ type: HTTP_PORT, port }` message — for the gateway topology where
   * the main thread parses HTTP and proxies to worker-owned listeners
   * (works on any Node version, unlike socket transfer). `0` = ephemeral.
   * The server still accepts transferred sockets either way — `listen` only
   * adds the internal gateway port.
   */
  listen?: number;
  /** Listen host; defaults to '127.0.0.1' so worker ports stay internal. */
  host?: string;
}

/**
 * Worker side: serve HTTP with an http.Server owned by this worker. Call it
 * once in the worker entry, after '@atolljs/node/shim':
 *
 *   import '@atolljs/node/shim';
 *   import { serveHttp } from '@atolljs/node/http';
 *   import express from 'express';
 *
 *   const app = express();          // any (req, res) handler works —
 *   app.get('/api', (_q, r) => …);  // express/koa .callback()/fastify.server
 *   serveHttp(app);                 // sockets transferred by createHttpCluster
 *   serveHttp(app, { listen: 0 });  // internal listener for routeHttpGateway
 *
 * Accepts a RequestListener (wrapped in a new http.Server), an existing
 * http.Server (e.g. `fastify().server` after ready()), or
 * `{ handler }` / `{ server }`. A no-op on the main thread.
 */
export function serveHttp(
  target: RequestListener | HttpServer | { handler?: RequestListener; server?: HttpServer },
  options?: ServeHttpOptions,
): HttpServer {
  const server =
    target instanceof HttpServer
      ? target
      : typeof target === 'function'
        ? createHttpServer(target)
        : target.server ?? createHttpServer(target.handler);

  if (isMainThread || !parentPort) return server;
  if (options?.listen === undefined) assertSocketTransferSupported();

  let announcedPort: number | undefined;
  parentPort.on('message', (msg: { type?: string; socket?: Socket }) => {
    if (msg?.type === HTTP_CONNECTION && msg.socket) {
      // Feed the accepted socket to this worker's HTTP stack — its stream is
      // still paused (pauseOnConnect), so resume after the parser attaches.
      server.emit('connection', msg.socket);
      msg.socket.resume();
    } else if (msg?.type === HTTP_PORT_QUERY && announcedPort !== undefined) {
      parentPort!.postMessage({ type: HTTP_PORT, port: announcedPort });
    }
  });

  if (options?.listen !== undefined) {
    server.listen(options.listen, options.host ?? '127.0.0.1', () => {
      const addr = server.address();
      announcedPort = typeof addr === 'object' && addr ? addr.port : 0;
      parentPort!.postMessage({ type: HTTP_PORT, port: announcedPort });
    });
  }
  return server;
}

/* ── worker port tracking — shared by gateway and proxy middleware ─────── */

export interface WorkerHttpPorts {
  /** Announced internal listener ports, keyed by worker instance (live map). */
  readonly ports: ReadonlyMap<Worker, number>;
  /**
   * Attach to any new workers in `source.workers` and re-query ones that
   * haven't announced — call it before resolving routes so respawns (and
   * announcements that raced the initial attach) are picked up.
   */
  refresh(): void;
  /** Detach all message listeners. */
  dispose(): void;
}

/**
 * Collect HTTP_PORT announcements from a pool's workers — for the
 * gateway/proxy topology where workers listen on internal TCP ports.
 * Announcements are a handshake, not a broadcast: workers that haven't
 * announced get an HTTP_PORT_QUERY so trackers attached late still learn
 * their ports.
 */
export function workerHttpPorts(source: WorkerSource): WorkerHttpPorts {
  const ports = new Map<Worker, number>();
  const listeners = new Map<Worker, (e: MessageEvent) => void>();
  const refresh = () => {
    for (const w of source.workers) {
      if (!listeners.has(w)) {
        const listener = (e: MessageEvent) => {
          const d = e.data as { type?: string; port?: number } | undefined;
          if (d?.type === HTTP_PORT && typeof d.port === 'number') ports.set(w, d.port);
        };
        listeners.set(w, listener);
        w.addEventListener('message', listener);
      }
      if (!ports.has(w)) {
        try {
          w.postMessage({ type: HTTP_PORT_QUERY });
        } catch {
          /* worker terminated between snapshot read and post — next refresh retries */
        }
      }
    }
  };
  refresh();
  return {
    ports,
    refresh,
    dispose: () => {
      for (const [w, l] of listeners) w.removeEventListener('message', l);
      listeners.clear();
    },
  };
}

/** Forward one request to a worker-owned listener and pipe the reply back. */
const forwardToPort = (
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  path: string,
): void => {
  const upstream = httpRequest(
    {
      host: '127.0.0.1',
      port,
      method: req.method,
      path: path.startsWith('/') ? path : `/${path}`,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    },
    (ures) => {
      res.writeHead(ures.statusCode ?? 502, ures.headers);
      ures.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
};

export interface ProxyToWorkerOptions {
  /** The pool whose workers announce internal HTTP ports. */
  pool: WorkerSource;
  /** Announcement tracker — from {@link workerHttpPorts} (refreshed per request). */
  tracker: WorkerHttpPorts;
  /** Which worker serves this route — a slot index into the live
   *  `pool.workers` snapshot, or a selector (e.g. round-robin). */
  worker: number | ((workers: readonly Worker[]) => Worker | undefined);
  /**
   * Prefix prepended to `req.url` before forwarding. When mounted via
   * `app.use('/prefix', mw)` Express has already stripped the mount — set
   * `to: '/prefix'` to restore it for the worker's routes.
   */
  to?: string;
}

/**
 * A mountable RequestListener that proxies to one pool worker's internal
 * listener — the piece that lets a host framework (Nest, Express, …) house
 * part of its API inside workers without giving up its own server:
 *
 *   const tracker = workerHttpPorts(pool);
 *   app.use('/api/housed', proxyToWorker({
 *     pool, tracker, to: '/api/housed',
 *     worker: (w) => w[i++ % w.length],   // or 0 to pin a slot
 *   }));
 */
export function proxyToWorker(options: ProxyToWorkerOptions): RequestListener {
  return (req, res) => {
    const port = resolveWorkerPort(options);
    if (port === undefined) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'worker not listening yet' }));
      return;
    }
    forwardToPort(req, res, port, (options.to ?? '') + (req.url ?? '/'));
  };
}

/** Resolve the target worker's announced port for proxy/cluster options. */
const resolveWorkerPort = (options: ProxyToWorkerOptions): number | undefined => {
  options.tracker.refresh();
  const workers = options.pool.workers;
  const worker =
    typeof options.worker === 'number' ? workers[options.worker] : options.worker(workers);
  return worker ? options.tracker.ports.get(worker) : undefined;
};

/**
 * Tunnel an HTTP Upgrade (WebSocket) handshake to a worker-owned listener:
 * replay the request line + headers verbatim against the worker's internal
 * port (rawHeaders preserves order, case, and duplicates), then splice the
 * two sockets into a raw bidirectional pipe. `head` is the first packet of
 * the upgraded stream the parser already consumed — it MUST be written after
 * the headers or the peer's first frames are lost.
 */
const tunnelUpgradeToPort = (
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  port: number,
  path: string,
): void => {
  const upstream = netConnect({ host: '127.0.0.1', port }, () => {
    const lines = [`${req.method} ${path} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      const value = key.toLowerCase() === 'host' ? `127.0.0.1:${port}` : req.rawHeaders[i + 1];
      lines.push(`${key}: ${value}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
};

/**
 * The upgrade-side sibling of {@link proxyToWorker}: middleware never sees
 * WebSocket handshakes (Node emits 'upgrade' on the server, bypassing
 * request listeners), so attach the returned listener to your server:
 *
 *   const tracker = workerHttpPorts(pool);
 *   app.use('/api/housed', proxyToWorker({ pool, tracker, to: '/api/housed', worker }));
 *   app.getHttpServer().on('upgrade',
 *     proxyUpgradeToWorker({ pool, tracker, worker })); // full URL — `to` not needed
 *
 * Unlike the middleware, an 'upgrade' listener receives the ORIGINAL url
 * (nothing stripped it), so `to` is a rewrite prefix rather than a mount
 * restore — usually omit it.
 */
export function proxyUpgradeToWorker(
  options: ProxyToWorkerOptions,
): (req: IncomingMessage, socket: Socket, head: Buffer) => void {
  return (req, socket, head) => {
    const port = resolveWorkerPort(options);
    if (port === undefined) {
      socket.destroy();
      return;
    }
    tunnelUpgradeToPort(req, socket, head, port, (options.to ?? '') + (req.url ?? '/'));
  };
}

/* ── gateway: path-level routing on the main thread ───────────────────────
   Clustering routes per-CONNECTION — it can't split a listener by URL
   path (the accepting thread never reads request bytes). To pin routes to
   worker A vs worker B vs the main thread, the main thread must parse HTTP
   and forward — this gateway does exactly that: workers listen on internal
   127.0.0.1 ports (serveHttp({ listen })), and matched prefixes proxy to the
   chosen pool worker; unmatched requests run in the main-thread handler.
   Works on any Node version.                                          */

export interface GatewayRoute {
  /** URL prefix that owns this route, e.g. '/api/a/'. */
  prefix: string;
  /** Which pool worker serves the prefix — a slot index into the live
   *  `pool.workers` snapshot, or a selector. Respawns are picked up. */
  worker: number | ((workers: readonly Worker[]) => Worker | undefined);
  /** Rewrite target prefix — the worker sees `to + url.slice(prefix.length)`.
   *  Defaults to '/', so `/api/a/x` arrives at the worker as `/x`. */
  to?: string;
}

export interface RouteHttpGatewayOptions {
  /** The pool whose workers announce internal HTTP ports. */
  pool: WorkerSource;
  port?: number;
  host?: string;
  /** BYO http.Server (the gateway attaches its request handler). */
  server?: HttpServer;
  routes?: GatewayRoute[];
  /** Everything unmatched runs on the main thread; defaults to 404. */
  handler?: RequestListener;
  /**
   * Fallback for unmatched Upgrade (WebSocket) handshakes — e.g. attach your
   * own ws server's handler to keep WS routes on the main thread. When
   * omitted the socket is destroyed, unless another 'upgrade' listener is
   * registered on the server (then it's left to that listener).
   */
  onUpgrade?: (req: IncomingMessage, socket: Socket, head: Buffer) => void;
  onListen?: (server: HttpServer) => void;
}

export interface HttpGateway {
  server: HttpServer;
  /** Announced internal listener ports, keyed by worker instance (live map). */
  ports: ReadonlyMap<Worker, number>;
  close(): Promise<void>;
}

/** Main thread: parse HTTP once and proxy matched prefixes to worker-owned
 *  listeners — the mixed topology: some routes in worker A, some in worker
 *  B, the rest served right here. Upgrade (WebSocket) handshakes match the
 *  same prefix table and are TUNNELED — the handshake is replayed to the
 *  worker's listener and the two sockets spliced, so frames flow end-to-end
 *  without the main thread touching them again. */
export function routeHttpGateway(options: RouteHttpGatewayOptions): HttpGateway {
  const tracker = workerHttpPorts(options.pool);
  const fallback: RequestListener =
    options.handler ?? ((_req, res) => res.writeHead(404).end());
  const server = options.server ?? createHttpServer();

  const resolveRoute = (url: string) => {
    tracker.refresh(); // respawned workers re-announce on the next request
    const workers = options.pool.workers;
    const route = options.routes?.find((r) => url.startsWith(r.prefix));
    const worker = route
      ? typeof route.worker === 'number'
        ? workers[route.worker]
        : route.worker(workers)
      : undefined;
    return { route, port: worker ? tracker.ports.get(worker) : undefined };
  };

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const { route, port } = resolveRoute(url);
    if (!route) {
      fallback(req, res);
      return;
    }
    if (port === undefined) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'worker not listening yet' }));
      return;
    }
    forwardToPort(req, res, port, (route.to ?? '/') + url.slice(route.prefix.length));
  });

  // Upgrade handshakes bypass 'request' entirely — match the same prefix
  // table and splice the client socket onto a fresh connection to the
  // worker's listener. After the handshake the main thread is out of the
  // data path: frames tunnel socket↔socket.
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = req.url ?? '/';
    const { route, port } = resolveRoute(url);
    if (!route || port === undefined) {
      if (options.onUpgrade) {
        options.onUpgrade(req, socket, head);
      } else if (server.listenerCount('upgrade') <= 1) {
        // No fallback and nobody else claimed it — preserve Node's
        // no-listener behavior (destroy) instead of leaking the socket.
        socket.destroy();
      }
      return;
    }
    tunnelUpgradeToPort(req, socket, head, port, (route.to ?? '/') + url.slice(route.prefix.length));
  });

  if (!options.server) {
    server.listen(options.port ?? 8080, options.host, () => options.onListen?.(server));
  } else {
    options.onListen?.(server);
  }
  return {
    server,
    ports: tracker.ports,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
