import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createNodePool } from '../src/pool';
import { routeHttpConnections, routeHttpGateway, SOCKET_TRANSFER_SUPPORTED } from '../src/http';

const fixture = fileURLToPath(new URL('../../../test/fixtures/httpServer.worker.mjs', import.meta.url));
const gatewayFixture = fileURLToPath(
  new URL('../../../test/fixtures/httpGateway.worker.mjs', import.meta.url),
);

// net.Socket transfer across worker_threads requires Node.js >= 26 — the
// routing tests below skip on older runtimes; the gate itself is asserted.
describe.runIf(!SOCKET_TRANSFER_SUPPORTED)('routeHttpConnections (unsupported runtime)', () => {
  it('throws a clear capability error', () => {
    const pool = createNodePool({ workerFile: fixture, poolSize: 1 });
    try {
      expect(() => routeHttpConnections({ pool, port: 0 })).toThrow(/Node\.js >= 26/);
    } finally {
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
});

const startRouter = async (poolSize: number) => {
  const pool = createNodePool({ workerFile: fixture, poolSize });
  const routed = routeHttpConnections({ pool, port: 0 });
  const port = await new Promise<number>((resolve) => {
    routed.server.once('listening', () => resolve((routed.server.address() as AddressInfo).port));
  });
  return { pool, routed, port };
};

describe.runIf(SOCKET_TRANSFER_SUPPORTED)('routeHttpConnections', () => {
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
});
