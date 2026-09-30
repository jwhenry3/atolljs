/**
 * Worker-side coverage for http.ts + shim.ts. `serveHttp` and the shim read
 * isMainThread/parentPort at call/eval time, so node:worker_threads is mocked
 * with a controllable triple and a fake parentPort (EventEmitter + postMessage
 * spy) stands in for the real channel — no real worker thread needed to cover
 * the worker branches. End-to-end wire behavior stays in
 * httpRouting.functional.test.ts.
 */
import { EventEmitter } from 'node:events';
import { createServer as createHttpServer, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTP_PORT, serveHttp, SOCKET_TRANSFER_SUPPORTED } from '../src/http';

const thread = vi.hoisted(() => ({
  isMainThread: true,
  parentPort: null as (EventEmitter & { postMessage: ReturnType<typeof vi.fn> }) | null,
}));

vi.mock('node:worker_threads', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:worker_threads')>();
  return {
    ...original,
    get isMainThread() {
      return thread.isMainThread;
    },
    get parentPort() {
      return thread.parentPort;
    },
  };
});

const fakePort = () => {
  const port = new EventEmitter() as EventEmitter & { postMessage: ReturnType<typeof vi.fn> };
  port.postMessage = vi.fn();
  return port;
};

describe('serveHttp — target shapes (main thread is a no-op)', () => {
  beforeEach(() => {
    thread.isMainThread = true;
    thread.parentPort = null;
  });

  it('wraps a RequestListener in a new http.Server and returns it', () => {
    const server = serveHttp((_req, res) => res.end('ok'));
    expect(server).toBeInstanceOf(HttpServer);
    server.close();
  });

  it('returns an existing HttpServer unchanged', () => {
    const existing = createHttpServer();
    expect(serveHttp(existing)).toBe(existing);
  });

  it('honors the { server } and { handler } object forms', () => {
    const existing = createHttpServer();
    expect(serveHttp({ server: existing })).toBe(existing);
    const wrapped = serveHttp({ handler: (_req, res) => res.end('ok') });
    expect(wrapped).toBeInstanceOf(HttpServer);
    expect(wrapped).not.toBe(existing);
    wrapped.close();
  });
});

describe('serveHttp — inside a worker', () => {
  let port: ReturnType<typeof fakePort>;
  let server: HttpServer | undefined;

  beforeEach(() => {
    thread.isMainThread = false;
    thread.parentPort = port = fakePort();
    server = undefined;
  });

  afterEach(async () => {
    thread.isMainThread = true;
    thread.parentPort = null;
    if (server?.listening) await new Promise<void>((r) => server!.close(() => r()));
  });

  /**
   * A stand-in HttpServer — emitting 'connection' on a REAL server would run
   * Node's internal connectionListener against our fake socket, so socket
   * feed tests drive a stub instead of the real parser.
   */
  const stubServer = () => ({
    emit: vi.fn(),
    on: vi.fn(),
    listen: vi.fn((_port: unknown, _host: unknown, cb?: () => void) => cb?.()),
    address: () => ({ port: 4242 }),
    close: vi.fn((cb?: () => void) => cb?.()),
    listening: false,
  });

  it('listens internally and announces the port over HTTP_PORT', async () => {
    server = serveHttp((_req, res) => res.end('ok'), { listen: 0 });
    // The announcement posts once the internal listener is up.
    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: HTTP_PORT, port: expect.any(Number) }),
      ),
    );
    const announced = port.postMessage.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === HTTP_PORT,
    )![0] as { port: number };
    expect(announced.port).toBeGreaterThan(0);
  });

  it('re-announces on HTTP_PORT_QUERY — and stays quiet before listening', async () => {
    server = serveHttp((_req, res) => res.end('ok'), { listen: 0 });
    // Query raced the listen callback — nothing to announce yet.
    port.postMessage.mockClear();
    port.emit('message', { type: 'HTTP_PORT_QUERY' });
    expect(port.postMessage).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
    port.postMessage.mockClear();
    port.emit('message', { type: 'HTTP_PORT_QUERY' });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: HTTP_PORT, port: expect.any(Number) }),
    );
  });

  it('feeds transferred sockets into the worker server and resumes them', () => {
    const stub = stubServer();
    server = serveHttp({ server: stub as unknown as HttpServer }, { listen: 0 });
    const socket = { resume: vi.fn() } as unknown as Socket;

    port.emit('message', { type: 'HTTP_CONNECTION', socket });
    // The socket is emitted onto the worker's own server — its HTTP parser —
    // then resumed (the acceptor kept it paused).
    expect(stub.emit).toHaveBeenCalledWith('connection', socket);
    expect(socket.resume).toHaveBeenCalledOnce();

    // A connection message without a socket (and unrelated traffic) is ignored.
    stub.emit.mockClear();
    port.emit('message', { type: 'HTTP_CONNECTION' });
    port.emit('message', { type: 'EXECUTE_TASK' });
    port.emit('message', undefined);
    expect(stub.emit).not.toHaveBeenCalled();
  });

  it('announces the address the internal listener actually got', () => {
    const stub = stubServer();
    server = serveHttp({ server: stub as unknown as HttpServer }, { listen: 0 });
    expect(stub.listen).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function));
    expect(port.postMessage).toHaveBeenCalledWith({ type: HTTP_PORT, port: 4242 });
  });

  it('announces port 0 when the listener reports a non-address (e.g. a pipe)', () => {
    const stub = { ...stubServer(), address: () => null };
    server = serveHttp({ server: stub as unknown as HttpServer }, { listen: 0 });
    expect(port.postMessage).toHaveBeenCalledWith({ type: HTTP_PORT, port: 0 });
  });

  it.runIf(SOCKET_TRANSFER_SUPPORTED)(
    'accepts transferred sockets without an internal listener (assert passes)',
    () => {
      // No `listen` — exercises the socket-transfer capability assert; on a
      // supported runtime it passes silently and still wires the socket feed.
      const stub = stubServer();
      server = serveHttp({ server: stub as unknown as HttpServer });
      const socket = { resume: vi.fn() } as unknown as Socket;
      port.emit('message', { type: 'HTTP_CONNECTION', socket });
      expect(stub.emit).toHaveBeenCalledWith('connection', socket);
      expect(socket.resume).toHaveBeenCalledOnce();
      expect(stub.listen).not.toHaveBeenCalled();
    },
  );

  it('throws a loud capability error without `listen` on runtimes lacking socket transfer', async () => {
    // Pin process.versions.node below 26 and re-import the module — the
    // SOCKET_TRANSFER_SUPPORTED gate computes at module load, so a fresh
    // module instance sees the unsupported runtime on any host Node version.
    const desc = Object.getOwnPropertyDescriptor(process.versions, 'node')!;
    Object.defineProperty(process.versions, 'node', { ...desc, value: '25.0.0' });
    try {
      vi.resetModules();
      const { serveHttp: unsupportedServeHttp, SOCKET_TRANSFER_SUPPORTED: supported } =
        await import('../src/http');
      expect(supported).toBe(false);
      expect(() => unsupportedServeHttp((_req, res) => res.end('ok'))).toThrow(
        /Node\.js >= 26/,
      );
      // `listen` still works on unsupported runtimes — the assert is skipped.
      const stub = stubServer();
      server = unsupportedServeHttp({ server: stub as unknown as HttpServer }, { listen: 0 });
      expect(stub.listen).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.versions, 'node', desc);
      vi.resetModules();
    }
  });
});

describe('shim — worker self global', () => {
  afterEach(() => {
    thread.isMainThread = true;
    thread.parentPort = null;
  });

  it('binds parentPort as `self` inside a worker', async () => {
    const port = fakePort();
    thread.isMainThread = false;
    thread.parentPort = port;
    const previous = (globalThis as { self?: unknown }).self;
    try {
      vi.resetModules();
      await import('../src/shim');
      expect((globalThis as { self?: unknown }).self).toBe(port);
    } finally {
      if (previous === undefined) delete (globalThis as { self?: unknown }).self;
      else (globalThis as { self?: unknown }).self = previous;
    }
  });

  it('is a no-op on the main thread', async () => {
    thread.isMainThread = true;
    thread.parentPort = null;
    const previous = (globalThis as { self?: unknown }).self;
    vi.resetModules();
    await import('../src/shim');
    expect((globalThis as { self?: unknown }).self).toBe(previous);
  });
});
