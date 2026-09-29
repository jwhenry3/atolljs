import { connect as netConnect, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createNodePool } from '../src/pool';
import { createServer as createHttpServer } from 'node:http';
import {
  createHttpCluster,
  proxyUpgradeToWorker,
  routeHttpGateway,
  stickyByAddress,
  workerHttpPorts,
  SOCKET_TRANSFER_SUPPORTED,
} from '../src/http';

const fixture = fileURLToPath(new URL('../../../test/fixtures/httpServer.worker.mjs', import.meta.url));
const gatewayFixture = fileURLToPath(
  new URL('../../../test/fixtures/httpGateway.worker.mjs', import.meta.url),
);

// net.Socket transfer across worker_threads requires Node.js >= 26 — the
// routing tests below skip on older runtimes; the gate itself is asserted.
// createHttpCluster bakes the capability check in: callers use it
// unconditionally and get null (plus a notice) on unsupported runtimes.
describe.runIf(!SOCKET_TRANSFER_SUPPORTED)('createHttpCluster (unsupported runtime)', () => {
  it('returns null and warns instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = createNodePool({ workerFile: fixture, poolSize: 1 });
    try {
      expect(createHttpCluster({ pool, port: 0 })).toBeNull();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toMatch(/Node\.js >= 26/);
    } finally {
      warn.mockRestore();
      pool.terminate();
    }
  });
});

// ── gateway: path-level ownership across workers + main — any Node ──────

const startGateway = async (poolSize: number) => {
  const pool = createNodePool({ workerFile: gatewayFixture, poolSize });
  const gateway = routeHttpGateway({
    pool,
    port: 0,
    routes: [
      { prefix: '/a/', to: '/', worker: 0 },
      { prefix: '/b/', to: '/', worker: 1 },
    ],
    handler: (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ threadId: 0 }));
    },
  });
  const port = await new Promise<number>((resolve) => {
    gateway.server.once('listening', () =>
      resolve((gateway.server.address() as AddressInfo).port),
    );
  });
  // Workers announce their internal ports asynchronously — wait for both.
  const deadline = Date.now() + 10_000;
  while (gateway.ports.size < poolSize) {
    if (Date.now() > deadline) throw new Error('workers did not announce ports');
    await new Promise((r) => setTimeout(r, 50));
  }
  return { pool, gateway, port };
};

/** Raw upgrade handshake over TCP — returns [raw response head, socket]. */
const upgradeRequest = (port: number, path: string) =>
  new Promise<[string, Socket]>((resolve, reject) => {
    const socket = netConnect({ host: '127.0.0.1', port }, () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: localhost:${port}\r\n` +
          'Upgrade: echo\r\n' +
          'Connection: Upgrade\r\n\r\n',
      );
    });
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const end = buf.indexOf('\r\n\r\n');
      if (end !== -1) {
        socket.off('data', onData);
        resolve([buf.slice(0, end), socket]);
      }
    };
    socket.on('data', onData);
    socket.on('error', reject);
  });

/** Write a payload on an upgraded socket and collect what echoes back. */
const echo = (socket: Socket, payload: string) =>
  new Promise<string>((resolve) => {
    socket.once('data', (chunk) => resolve(chunk.toString('utf8')));
    socket.write(payload);
  });

describe('routeHttpGateway', () => {
  it('pins prefixes to specific workers and leaves the rest on main', async () => {
    const { pool, gateway, port } = await startGateway(2);
    try {
      const [a, b, main] = await Promise.all([
        fetch(`http://localhost:${port}/a/who`).then((r) => r.json()),
        fetch(`http://localhost:${port}/b/who`).then((r) => r.json()),
        fetch(`http://localhost:${port}/elsewhere`).then((r) => r.json()),
      ]);
      // Each prefix landed on its designated pool slot; they differ; the
      // unmatched request stayed on the API thread (threadId 0).
      expect(a.threadId).toBeGreaterThan(0);
      expect(b.threadId).toBeGreaterThan(0);
      expect(a.threadId).not.toBe(b.threadId);
      expect(main.threadId).toBe(0);
      // 'to: /' stripped the prefix — the worker saw '/who'.
      expect(a.url).toBe('/who');
      expect(b.url).toBe('/who');
    } finally {
      await gateway.close();
      pool.terminate();
    }
  });

  it('tunnels upgrade handshakes to the owning worker — socket spliced, frames echo', async () => {
    const { pool, gateway, port } = await startGateway(2);
    try {
      const [head, socket] = await upgradeRequest(port, '/a/echo');
      try {
        expect(head).toContain('101 Switching Protocols');
        // The handshake ran inside the OWNING worker (slot 0), and 'to: /'
        // rewrote the path — proof the tunnel honored route resolution.
        expect(Number(head.match(/x-worker: (\d+)/i)?.[1])).toBeGreaterThan(0);
        expect(head).toMatch(/x-url: \/echo/i);
        // Post-upgrade bytes splice straight through the tunnel.
        expect(await echo(socket, 'hello')).toBe('hello');
      } finally {
        socket.destroy();
      }
    } finally {
      await gateway.close();
      pool.terminate();
    }
  });

  it('destroys unmatched upgrade sockets (no fallback registered)', async () => {
    const { pool, gateway, port } = await startGateway(1);
    try {
      const closed = await new Promise<boolean>((resolve) => {
        const s = netConnect({ host: '127.0.0.1', port }, () =>
          s.write(
            'GET /nowhere/echo HTTP/1.1\r\nHost: x\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n',
          ),
        );
        s.on('error', () => {}); // ECONNRESET is the expected teardown
        s.on('close', () => resolve(true));
      });
      expect(closed).toBe(true);
    } finally {
      await gateway.close();
      pool.terminate();
    }
  });

  it('proxyUpgradeToWorker — a bare server upgrade listener tunnels to the worker', async () => {
    const pool = createNodePool({ workerFile: gatewayFixture, poolSize: 1 });
    const tracker = workerHttpPorts(pool);
    const server = createHttpServer((_req, res) => res.writeHead(404).end());
    server.on('upgrade', proxyUpgradeToWorker({ pool, tracker, worker: 0 }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      // Wait for the worker's HTTP_PORT announcement, then upgrade.
      const deadline = Date.now() + 10_000;
      while (tracker.ports.size < 1) {
        if (Date.now() > deadline) throw new Error('worker did not announce port');
        tracker.refresh();
        await new Promise((r) => setTimeout(r, 50));
      }
      const [head, socket] = await upgradeRequest(port, '/socket.io/');
      try {
        expect(head).toContain('101 Switching Protocols');
        expect(Number(head.match(/x-worker: (\d+)/i)?.[1])).toBeGreaterThan(0);
      } finally {
        socket.destroy();
      }
    } finally {
      tracker.dispose();
      await new Promise<void>((r) => server.close(() => r()));
      pool.terminate();
    }
  });
});

const startRouter = async (poolSize: number) => {
  const pool = createNodePool({ workerFile: fixture, poolSize });
  const routed = createHttpCluster({ pool, port: 0 })!; // gated by runIf above
  const port = await new Promise<number>((resolve) => {
    routed.server.once('listening', () => resolve((routed.server.address() as AddressInfo).port));
  });
  return { pool, routed, port };
};

describe('stickyByAddress', () => {
  // Stand-ins — the route hook only needs identity + array position.
  const fakeWorkers = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }] as any;
  const sock = (ip: string) => ({ remoteAddress: ip }) as Socket;

  it('pins one client address to one worker, deterministically', () => {
    const route = stickyByAddress();
    const first = route(sock('10.0.0.7'), fakeWorkers);
    for (let i = 0; i < 8; i++) {
      expect(route(sock('10.0.0.7'), fakeWorkers)).toBe(first);
    }
    expect(route(sock('10.0.0.7'), [])).toBeUndefined();
  });

  it('spreads distinct clients across the pool', () => {
    const route = stickyByAddress();
    const picks = new Set(
      Array.from({ length: 50 }, (_, i) => route(sock(`10.0.1.${i}`), fakeWorkers)),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it('rendezvous hashing — removing a worker only remaps its own clients', () => {
    const route = stickyByAddress();
    const ips = Array.from({ length: 60 }, (_, i) => `192.168.0.${i}`);
    const before = new Map(ips.map((ip) => [ip, route(sock(ip), fakeWorkers)]));
    // Drop whichever worker owns the first ip:
    const evicted = before.get(ips[0])!;
    const rest = fakeWorkers.filter((w: unknown) => w !== evicted);
    let moved = 0;
    for (const ip of ips) {
      const now = route(sock(ip), rest);
      if (before.get(ip) !== evicted && now !== before.get(ip)) moved++;
    }
    // Non-evicted clients keep their worker (the rendezvous property).
    expect(moved).toBe(0);
  });
});

describe.runIf(SOCKET_TRANSFER_SUPPORTED)('createHttpCluster', () => {
  it('serves transferred sockets inside workers — parsing and replies off-thread', async () => {
    const { pool, routed, port } = await startRouter(2);
    try {
      const res = await fetch(`http://localhost:${port}/hello`);
      expect(res.status).toBe(200);
      const body = await res.json();
      // threadId > 0 proves the response came from a worker, not the API thread.
      expect(body.threadId).toBeGreaterThan(0);
      expect(body.url).toBe('/hello');
      expect(body.method).toBe('GET');
    } finally {
      await routed.close();
      pool.terminate();
    }
  });

  it('round-robins connections across the pool', async () => {
    const { pool, routed, port } = await startRouter(4);
    try {
      const bodies = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          fetch(`http://localhost:${port}/r${i}`).then((r) => r.json()),
        ),
      );
      const threads = new Set(bodies.map((b) => b.threadId));
      // 8 connections over 4 workers — at least two distinct threads answered.
      expect(threads.size).toBeGreaterThan(1);
      for (const b of bodies) expect(b.threadId).toBeGreaterThan(0);
    } finally {
      await routed.close();
      pool.terminate();
    }
  });

  it('coexists with task dispatch on the same pool', async () => {
    const { pool, routed, port } = await startRouter(2);
    try {
      // A dispatched task and an HTTP request both land on worker threads.
      const [taskThread, body] = await Promise.all([
        pool.runTask({ taskId: 't-thread' } as any),
        fetch(`http://localhost:${port}/x`).then((r) => r.json()),
      ]);
      expect(taskThread).toBeGreaterThan(0);
      expect(body.threadId).toBeGreaterThan(0);
    } finally {
      await routed.close();
      pool.terminate();
    }
  });

  it('stickyByAddress pins all of a client\'s connections to one worker', async () => {
    const pool = createNodePool({ workerFile: fixture, poolSize: 4 });
    const routed = createHttpCluster({ pool, port: 0, route: stickyByAddress() })!;
    const port = await new Promise<number>((resolve) => {
      routed.server.once('listening', () =>
        resolve((routed.server.address() as AddressInfo).port),
      );
    });
    try {
      // 6 sequential connections from 127.0.0.1 — same address, same worker,
      // unlike the round-robin default which spread them. 'connection: close'
      // forces a fresh socket each time (keep-alive would reuse one).
      const bodies = [] as { threadId: number }[];
      for (let i = 0; i < 6; i++) {
        bodies.push(
          await fetch(`http://localhost:${port}/s${i}`, {
            headers: { connection: 'close' },
          }).then((r) => r.json()),
        );
      }
      const threads = new Set(bodies.map((b) => b.threadId));
      expect(threads.size).toBe(1);
      expect([...threads][0]).toBeGreaterThan(0);
    } finally {
      await routed.close();
      pool.terminate();
    }
  });
});
