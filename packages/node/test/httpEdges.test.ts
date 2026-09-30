/**
 * Edge-branch coverage for http.ts that runs entirely on the main thread:
 * proxyToWorker's `to` rewrite / selector / 503 paths, forwardToPort's
 * upstream-error 502, proxyUpgradeToWorker's unmatched destroys, the
 * gateway's 503 / onUpgrade / other-listener / BYO-server branches, and the
 * createHttpCluster socket-destroy + transfer-failure paths (socket-transfer
 * gated). ServeHttp's worker-side branches live in httpWorkerSide.test.ts.
 */
import { createServer as createHttpServer, type RequestListener } from 'node:http';
import {
  connect as netConnect,
  createServer as createNetServer,
  type AddressInfo,
  type Socket,
} from 'node:net';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createNodePool } from '../src/pool';
import {
  createHttpCluster,
  HTTP_PORT,
  proxyToWorker,
  proxyUpgradeToWorker,
  routeHttpGateway,
  SOCKET_TRANSFER_SUPPORTED,
  stickyByAddress,
  workerHttpPorts,
} from '../src/http';

const gatewayFixture = fileURLToPath(
  new URL('../../../test/fixtures/httpGateway.worker.mjs', import.meta.url),
);
const httpFixture = fileURLToPath(
  new URL('../../../test/fixtures/httpServer.worker.mjs', import.meta.url),
);

const listen = (server: { listen: Function; once: Function }) =>
  new Promise<number>((resolve) => {
    server.once('listening', () =>
      resolve((server as unknown as { address(): AddressInfo }).address().port),
    );
    (server as { listen: Function }).listen(0, '127.0.0.1');
  });

/** Port of a server the SUT already called .listen() on (gateway/cluster own it). */
const whenListening = (server: { once: Function; address: () => unknown }) =>
  new Promise<number>((resolve) => {
    const addr = server.address();
    if (addr && typeof addr === 'object') return resolve((addr as AddressInfo).port);
    server.once('listening', () =>
      resolve((server.address() as AddressInfo).port),
    );
  });

const close = (server: { close: Function }) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

/** Connect, send a request, resolve when the socket closes (destroyed or FIN). */
const connectUntilClose = (port: number, request?: string) =>
  new Promise<boolean>((resolve) => {
    const socket = netConnect({ host: '127.0.0.1', port }, () => {
      if (request) socket.write(request);
      else socket.end();
    });
    socket.on('error', () => {}); // ECONNRESET is expected teardown
    socket.on('close', () => resolve(true));
  });

const upgradeHandshake = (path: string, port: number) =>
  `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n`;

/** A connected client/server socket pair on a throwaway TCP server. */
const socketPair = async () => {
  const hub = createNetServer();
  const port = await listen(hub);
  const serverSide = new Promise<Socket>((resolve) => hub.once('connection', resolve));
  const client = netConnect({ host: '127.0.0.1', port });
  const [socket] = await Promise.all([
    serverSide,
    new Promise<void>((resolve) => client.once('connect', resolve)),
  ]);
  return {
    client,
    socket,
    close: () => new Promise<void>((r) => hub.close(() => r())),
  };
};

/** A res stand-in: PassThrough body + writeHead spy (what forwardToPort needs). */
const fakeRes = () => {
  const res = new PassThrough() as PassThrough & {
    writeHead: ReturnType<typeof vi.fn>;
    headersSent: boolean;
  };
  res.writeHead = vi.fn(() => res);
  res.headersSent = false;
  return res;
};

describe('workerHttpPorts', () => {
  it('attaches a message listener, queries unannounced workers, and tracks HTTP_PORT', () => {
    const worker = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
    };
    const source = { workers: [worker as unknown as Worker] };
    const tracker = workerHttpPorts(source);
    try {
      expect(worker.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
      expect(worker.postMessage).toHaveBeenCalledWith({ type: 'HTTP_PORT_QUERY' });

      // Feed the captured listener — only well-formed HTTP_PORT lands.
      const listener = worker.addEventListener.mock.calls[0][1] as (e: unknown) => void;
      listener({ data: { type: 'OTHER' } });
      listener({ data: { type: HTTP_PORT, port: 'not-a-number' } });
      expect(tracker.ports.has(worker as unknown as Worker)).toBe(false);
      listener({ data: { type: HTTP_PORT, port: 4321 } });
      expect(tracker.ports.get(worker as unknown as Worker)).toBe(4321);

      // Announced workers aren't re-queried on refresh.
      worker.postMessage.mockClear();
      tracker.refresh();
      expect(worker.postMessage).not.toHaveBeenCalled();
    } finally {
      tracker.dispose();
    }
    expect(worker.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('swallows postMessage failures for dead workers — the next refresh retries', () => {
    const worker = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(() => {
        throw new Error('worker terminated');
      }),
    };
    const tracker = workerHttpPorts({ workers: [worker as unknown as Worker] });
    try {
      expect(() => tracker.refresh()).not.toThrow();
      expect(worker.postMessage).toHaveBeenCalledWith({ type: 'HTTP_PORT_QUERY' });
    } finally {
      tracker.dispose();
    }
  });
});

describe('proxyToWorker', () => {
  const startAnnouncedPool = async () => {
    const pool = createNodePool({ workerFile: gatewayFixture, poolSize: 1 });
    const tracker = workerHttpPorts(pool);
    await vi.waitFor(() => {
      tracker.refresh();
      expect(tracker.ports.size).toBe(1);
    });
    return { pool, tracker };
  };

  const mount = async (listener: RequestListener) => {
    const server = createHttpServer(listener);
    const port = await listen(server);
    return { server, port };
  };

  it('forwards to the selected worker with the `to` prefix prepended', async () => {
    const { pool, tracker } = await startAnnouncedPool();
    const { server, port } = await mount(
      proxyToWorker({ pool, tracker, worker: 0, to: '/api/housed' }),
    );
    try {
      const res = await fetch(`http://127.0.0.1:${port}/items?q=1`, {
        method: 'POST',
        body: 'payload',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // `to` restored the mount prefix — the worker saw /api/housed/items?q=1.
      expect(body.url).toBe('/api/housed/items?q=1');
      expect(body.method).toBe('POST');
      expect(body.threadId).toBeGreaterThan(0);
    } finally {
      await close(server);
      tracker.dispose();
      pool.terminate();
    }
  });

  it('supports a worker-selector function and normalizes a bare `to` prefix', async () => {
    const { pool, tracker } = await startAnnouncedPool();
    let seen: readonly Worker[] = [];
    const { server, port } = await mount(
      proxyToWorker({
        pool,
        tracker,
        to: 'bare', // no leading slash — forwardToPort must add it
        worker: (workers) => {
          seen = workers;
          return workers[0];
        },
      }),
    );
    try {
      const res = await fetch(`http://127.0.0.1:${port}/y`);
      expect(res.status).toBe(200);
      expect((await res.json()).url).toBe('/bare/y');
      // pool.workers is a fresh snapshot per read — the selector saw the live one.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(pool.workers[0]);
    } finally {
      await close(server);
      tracker.dispose();
      pool.terminate();
    }
  });

  it('passes the request URL through untouched when `to` is omitted', async () => {
    const { pool, tracker } = await startAnnouncedPool();
    const { server, port } = await mount(proxyToWorker({ pool, tracker, worker: 0 }));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/plain/path?x=1`);
      expect(res.status).toBe(200);
      expect((await res.json()).url).toBe('/plain/path?x=1');
    } finally {
      await close(server);
      tracker.dispose();
      pool.terminate();
    }
  });

  it('answers 503 when the selected worker has no announced port', async () => {
    const { pool, tracker } = await startAnnouncedPool();
    const phantom = {} as Worker;
    const bySelector = await mount(
      proxyToWorker({ pool, tracker, worker: () => phantom }),
    );
    const outOfRange = await mount(proxyToWorker({ pool, tracker, worker: 9 }));
    try {
      const a = await fetch(`http://127.0.0.1:${bySelector.port}/x`);
      expect(a.status).toBe(503);
      expect(await a.json()).toEqual({ error: 'worker not listening yet' });
      const b = await fetch(`http://127.0.0.1:${outOfRange.port}/x`);
      expect(b.status).toBe(503);
    } finally {
      await close(bySelector.server);
      await close(outOfRange.server);
      tracker.dispose();
      pool.terminate();
    }
  });

  it('answers 502 when the worker port has stopped accepting connections', async () => {
    // Reserve then release a port so connects refuse deterministically.
    const probe = createNetServer();
    const deadPort = await listen(probe);
    await close(probe);

    const pool = { workers: [] as Worker[] };
    const tracker = workerHttpPorts(pool);
    const ghost = {} as Worker;
    (tracker.ports as Map<Worker, number>).set(ghost, deadPort);
    const { server, port } = await mount(
      proxyToWorker({ pool, tracker, worker: () => ghost }),
    );
    try {
      const res = await fetch(`http://127.0.0.1:${port}/gone`);
      expect(res.status).toBe(502);
    } finally {
      await close(server);
      tracker.dispose();
    }
  });

  it('treats a missing req.url as /', async () => {
    // A tiny upstream that echoes its request URL — the proxied request
    // carries a fabricated IncomingMessage with no url.
    const upstream = createHttpServer((req, res) => res.end(req.url));
    const upstreamPort = await listen(upstream);
    const pool = { workers: [] as Worker[] };
    const tracker = workerHttpPorts(pool);
    const ghost = {} as Worker;
    (tracker.ports as Map<Worker, number>).set(ghost, upstreamPort);
    const listener = proxyToWorker({ pool, tracker, worker: () => ghost });
    try {
      const res = fakeRes();
      const body = new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      const req = {
        url: undefined,
        method: 'GET',
        headers: {},
        pipe: (dest: { end: () => void }) => dest.end(),
      };
      listener(req as never, res as never);
      // The upstream round-trip is async — the body resolves after writeHead.
      expect(await body).toBe('/');
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
    } finally {
      tracker.dispose();
      await close(upstream);
    }
  });
});

describe('proxyUpgradeToWorker — unmatched cases', () => {
  it('destroys the socket when the worker has no announced port', async () => {
    const pool = { workers: [] as Worker[] };
    const tracker = workerHttpPorts(pool);
    const server = createHttpServer((_req, res) => res.writeHead(404).end());
    server.on('upgrade', proxyUpgradeToWorker({ pool, tracker, worker: () => undefined }));
    const port = await listen(server);
    try {
      expect(await connectUntilClose(port, upgradeHandshake('/x', port))).toBe(true);
    } finally {
      tracker.dispose();
      await close(server);
    }
  });

  it('destroys the client socket when the worker listener is unreachable', async () => {
    const probe = createNetServer();
    const deadPort = await listen(probe);
    await close(probe);

    const pool = { workers: [] as Worker[] };
    const tracker = workerHttpPorts(pool);
    const ghost = {} as Worker;
    (tracker.ports as Map<Worker, number>).set(ghost, deadPort);
    const server = createHttpServer((_req, res) => res.writeHead(404).end());
    server.on('upgrade', proxyUpgradeToWorker({ pool, tracker, worker: () => ghost }));
    const port = await listen(server);
    try {
      // The tunnel's upstream connect fails → client socket destroyed.
      expect(await connectUntilClose(port, upgradeHandshake('/ws', port))).toBe(true);
    } finally {
      tracker.dispose();
      await close(server);
    }
  });

  it('replays a missing req.url as / and writes a non-empty head after headers', async () => {
    const pool = createNodePool({ workerFile: gatewayFixture, poolSize: 1 });
    const tracker = workerHttpPorts(pool);
    const upgrade = proxyUpgradeToWorker({ pool, tracker, worker: 0 });
    const { client, socket, close: closeHub } = await socketPair();
    try {
      await vi.waitFor(() => {
        tracker.refresh();
        expect(tracker.ports.size).toBe(1);
      });
      // Invoke the upgrade listener directly with a fabricated request — url
      // missing — plus a non-empty head the parser "already consumed" (the
      // head is written to the worker right after the replayed headers; the
      // echo fixture consumes it as its own upgrade head, so we only assert
      // the replayed handshake here).
      const req = {
        url: undefined,
        method: 'GET',
        httpVersion: '1.1',
        rawHeaders: ['Host', '127.0.0.1', 'Upgrade', 'echo', 'Connection', 'Upgrade'],
      };
      const received = new Promise<string>((resolve) => {
        let buf = '';
        client.on('data', (c) => {
          buf += c.toString('utf8');
          if (buf.includes('\r\n\r\n')) resolve(buf);
        });
      });
      upgrade(req as never, socket, Buffer.from('HEAD-PROOF'));
      const head = await received;
      expect(head).toContain('101 Switching Protocols');
      expect(head).toMatch(/x-url: \//i); // tunneled as GET / — no url given
    } finally {
      client.destroy();
      socket.destroy();
      await closeHub();
      tracker.dispose();
      pool.terminate();
    }
  });
});

describe('routeHttpGateway edge branches', () => {
  it('503s a matched route whose worker has not announced a port', async () => {
    const phantom = {} as Worker;
    const gateway = routeHttpGateway({
      pool: { workers: [] as Worker[] },
      port: 0,
      routes: [{ prefix: '/dead/', worker: () => phantom }],
    });
    const port = await whenListening(gateway.server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/dead/x`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'worker not listening yet' });
    } finally {
      await gateway.close();
    }
  });

  it('defaults `to` to / — the worker sees the suffix only', async () => {
    const pool = createNodePool({ workerFile: gatewayFixture, poolSize: 1 });
    const gateway = routeHttpGateway({
      pool,
      port: 0,
      routes: [{ prefix: '/c/', worker: 0 }], // no `to`
      handler: (_req, res) => res.writeHead(404).end(),
    });
    const port = await whenListening(gateway.server);
    try {
      await vi.waitFor(() => expect(gateway.ports.size).toBe(1));
      const res = await fetch(`http://127.0.0.1:${port}/c/zap`);
      expect((await res.json()).url).toBe('/zap');
    } finally {
      await gateway.close();
      pool.terminate();
    }
  });

  it('tunnels an upgrade through a route with the default `to` rewrite', async () => {
    const pool = createNodePool({ workerFile: gatewayFixture, poolSize: 1 });
    const gateway = routeHttpGateway({
      pool,
      port: 0,
      routes: [{ prefix: '/c/', worker: 0 }], // no `to`
    });
    const port = await whenListening(gateway.server);
    try {
      await vi.waitFor(() => expect(gateway.ports.size).toBe(1));
      // Read the 101 head so we can assert the rewritten path.
      const head = await new Promise<string>((resolve, reject) => {
        const socket = netConnect({ host: '127.0.0.1', port }, () =>
          socket.write(upgradeHandshake('/c/echo', port)),
        );
        let buf = '';
        const onData = (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          const end = buf.indexOf('\r\n\r\n');
          if (end !== -1) {
            socket.destroy();
            resolve(buf.slice(0, end));
          }
        };
        socket.on('data', onData);
        socket.on('error', reject);
      });
      expect(head).toContain('101 Switching Protocols');
      expect(head).toMatch(/x-url: \/echo/i);
    } finally {
      await gateway.close();
      pool.terminate();
    }
  });

  it('treats a missing req.url as / for both request and upgrade paths', async () => {
    const pool = createNodePool({ workerFile: gatewayFixture, poolSize: 1 });
    const gateway = routeHttpGateway({
      pool,
      port: 0,
      routes: [{ prefix: '/', to: '/', worker: 0 }],
    });
    await whenListening(gateway.server);
    const { client, socket, close: closeHub } = await socketPair();
    try {
      await vi.waitFor(() => expect(gateway.ports.size).toBe(1));

      // 'request' path — fabricated IncomingMessage without url.
      const res = fakeRes();
      const body = new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      gateway.server.emit(
        'request',
        {
          url: undefined,
          method: 'GET',
          headers: {},
          pipe: (dest: { end: () => void }) => dest.end(),
        } as never,
        res as never,
      );
      expect(JSON.parse(await body).url).toBe('/');

      // 'upgrade' path — same fabricated req, real socket pair. The Upgrade
      // + Connection headers are what make the WORKER's http.Server treat the
      // replayed request as a handshake rather than a plain GET.
      const req = {
        url: undefined,
        method: 'GET',
        httpVersion: '1.1',
        rawHeaders: ['Host', '127.0.0.1', 'Upgrade', 'echo', 'Connection', 'Upgrade'],
      };
      const received = new Promise<string>((resolve) => {
        let buf = '';
        client.on('data', (c) => {
          buf += c.toString('utf8');
          if (buf.includes('\r\n\r\n')) resolve(buf);
        });
      });
      gateway.server.emit('upgrade', req as never, socket, Buffer.alloc(0));
      const head = await received;
      expect(head).toContain('101 Switching Protocols');
      expect(head).toMatch(/x-url: \//i);
    } finally {
      client.destroy();
      socket.destroy();
      await closeHub();
      await gateway.close();
      pool.terminate();
    }
  });

  it('close() rejects when a caller-supplied server was never listening', async () => {
    const gateway = routeHttpGateway({
      pool: { workers: [] as Worker[] },
      server: createHttpServer(), // never listen()ed
    });
    await expect(gateway.close()).rejects.toThrow();
  });

  it('hands unmatched upgrades to options.onUpgrade', async () => {
    const onUpgrade = vi.fn((_req: unknown, socket: { destroy: () => void }) =>
      socket.destroy(),
    );
    const gateway = routeHttpGateway({
      pool: { workers: [] as Worker[] },
      port: 0,
      routes: [{ prefix: '/a/', worker: 0 }],
      onUpgrade,
    });
    const port = await whenListening(gateway.server);
    try {
      expect(await connectUntilClose(port, upgradeHandshake('/nowhere', port))).toBe(true);
      expect(onUpgrade).toHaveBeenCalledOnce();
    } finally {
      await gateway.close();
    }
  });

  it('leaves unmatched upgrade sockets alone when another upgrade listener is registered', async () => {
    const gateway = routeHttpGateway({
      pool: { workers: [] as Worker[] },
      port: 0,
      routes: [{ prefix: '/a/', worker: 0 }],
    });
    // A second listener claims the socket — the gateway must not destroy it.
    let seenDestroyed: boolean | undefined;
    gateway.server.on('upgrade', (_req, socket: { destroyed: boolean; destroy: () => void }) => {
      seenDestroyed = socket.destroyed;
      socket.destroy();
    });
    const port = await whenListening(gateway.server);
    try {
      expect(await connectUntilClose(port, upgradeHandshake('/other', port))).toBe(true);
      expect(seenDestroyed).toBe(false);
    } finally {
      await gateway.close();
    }
  });

  it('attaches its handlers to a caller-supplied server and fires onListen', async () => {
    const pool = createNodePool({ workerFile: gatewayFixture, poolSize: 1 });
    const server = createHttpServer();
    const port = await listen(server);
    const onListen = vi.fn();
    const gateway = routeHttpGateway({
      pool,
      server,
      onListen,
      routes: [{ prefix: '/a/', to: '/', worker: 0 }],
      handler: (_req, res) => res.writeHead(418).end(),
    });
    try {
      // BYO server → onListen fires synchronously instead of after listen().
      expect(onListen).toHaveBeenCalledWith(server);
      await vi.waitFor(() => expect(gateway.ports.size).toBe(1));
      const res = await fetch(`http://127.0.0.1:${port}/a/who`);
      expect((await res.json()).url).toBe('/who');
      const fallback = await fetch(`http://127.0.0.1:${port}/main`);
      expect(fallback.status).toBe(418);
    } finally {
      await gateway.close();
      pool.terminate();
    }
  });
});

describe('stickyByAddress — edge branches', () => {
  it('routes deterministically even without a remoteAddress', () => {
    const workers = [{ id: 0 }, { id: 1 }] as unknown as Worker[];
    const route = stickyByAddress();
    const first = route({ remoteAddress: undefined } as never, workers);
    expect(first).toBeDefined();
    expect(route({} as never, workers)).toBe(first);
    // A custom key is mixed into the hash.
    const keyed = stickyByAddress(() => 'session-9');
    expect(keyed({ remoteAddress: '10.0.0.1' } as never, workers)).toBeDefined();
  });
});

describe('createHttpCluster — capability gate', () => {
  it('returns null and warns on runtimes without socket transfer (any host Node)', async () => {
    // Pin process.versions.node below 26 and re-import — the gate computes at
    // module load, so a fresh module instance sees the unsupported runtime.
    const desc = Object.getOwnPropertyDescriptor(process.versions, 'node')!;
    Object.defineProperty(process.versions, 'node', { ...desc, value: '25.0.0' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.resetModules();
      const http = await import('../src/http');
      expect(http.SOCKET_TRANSFER_SUPPORTED).toBe(false);
      expect(http.createHttpCluster({ pool: { workers: [] }, port: 0 })).toBeNull();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toMatch(/Node\.js >= 26/);
    } finally {
      warn.mockRestore();
      Object.defineProperty(process.versions, 'node', desc);
      vi.resetModules();
    }
  });
});

describe.runIf(SOCKET_TRANSFER_SUPPORTED)('createHttpCluster edges', () => {
  it('destroys the socket when the pool is empty (default route → undefined)', async () => {
    const routed = createHttpCluster({ pool: { workers: [] }, port: 0, host: '127.0.0.1' })!;
    const port = await whenListening(routed.server);
    try {
      expect(await connectUntilClose(port)).toBe(true);
    } finally {
      await routed.close();
    }
  });

  it('close() rejects when the server was never listening', async () => {
    const server = createNetServer({ pauseOnConnect: true }); // never listen()ed
    const routed = createHttpCluster({ pool: { workers: [] }, server })!;
    await expect(routed.close()).rejects.toThrow();
  });

  it('destroys the socket when routing selects no worker', async () => {
    const pool = createNodePool({ workerFile: httpFixture, poolSize: 1 });
    const routed = createHttpCluster({ pool, port: 0, route: () => undefined })!;
    const port = await whenListening(routed.server);
    try {
      expect(await connectUntilClose(port)).toBe(true);
    } finally {
      await routed.close();
      pool.terminate();
    }
  });

  it('emits server "error" and destroys the socket when the transfer post fails', async () => {
    const deadWorker = {
      postMessage: () => {
        throw new Error('socket could not be cloned');
      },
    };
    const routed = createHttpCluster({
      pool: { workers: [deadWorker as unknown as Worker] },
      port: 0,
    })!;
    const port = await whenListening(routed.server);
    try {
      const errPromise = new Promise<Error>((resolve) =>
        routed.server.once('error', resolve),
      );
      const closed = connectUntilClose(port);
      await expect(errPromise).resolves.toMatchObject({
        message: expect.stringMatching(/could not be cloned/),
      });
      expect(await closed).toBe(true);
    } finally {
      await routed.close();
    }
  });

  it('serves connections through a caller-supplied pauseOnConnect server', async () => {
    const pool = createNodePool({ workerFile: httpFixture, poolSize: 1 });
    const server = createNetServer({ pauseOnConnect: true });
    const port = await listen(server);
    const onListen = vi.fn();
    const routed = createHttpCluster({ pool, server, onListen })!;
    try {
      // BYO server → onListen fires immediately, not after a listen call.
      expect(onListen).toHaveBeenCalledWith(server);
      const res = await fetch(`http://127.0.0.1:${port}/via-byo`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.threadId).toBeGreaterThan(0);
      expect(body.url).toBe('/via-byo');
    } finally {
      await routed.close();
      pool.terminate();
    }
  });
});
