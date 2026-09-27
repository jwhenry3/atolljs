import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Boots the real host + client modules with fresh state per test, linked by a
 * MessageChannel — port1 goes to the host (as SharedWorker would deliver it
 * via `onconnect`), port2 is handed to the client as a pre-opened port.
 */
async function boot() {
  vi.resetModules();
  const shared = await import('../contract/sharedMemory');
  const { TaskRegistry } = await import('../worker/registry');
  const { attachSharedPort } = await import('./sharedWorkerHost');
  const { connectSharedWorker } = await import('./sharedWorkerClient');

  const link = () => {
    const channel = new MessageChannel();
    attachSharedPort(channel.port1);
    return channel.port2;
  };

  return { shared, TaskRegistry, connectSharedWorker, link };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sharedWorker', () => {
  it('connects, binds the client contract to the worker-owned buffer', async () => {
    const { shared, connectSharedWorker, link } = await boot();
    const mem = shared.defineSharedMemory({ counter: shared.field.number() });

    const client = await connectSharedWorker({ port: link(), sharedMemory: mem });

    expect(client.clientIndex).toBe(1);
    mem.counter.write(42);
    expect(mem.counter.read()).toBe(42);
  });

  it('executes tasks via the registry and exposes first-class task methods', async () => {
    const { shared, TaskRegistry, connectSharedWorker, link } = await boot();
    const mem = shared.defineSharedMemory({ counter: shared.field.number() });
    TaskRegistry.register({ taskId: 'inc' }, (x: number) => {
      mem.counter.write(mem.counter.read() + x);
      return mem.counter.read();
    });

    const client = await connectSharedWorker({
      port: link(),
      sharedMemory: mem,
      tasks: { inc: { taskId: 'inc' } },
    });

    expect(await client.inc(5)).toBe(5);
    expect(await client.inc(3)).toBe(8);
  });

  it('shares one buffer across multiple clients — writes by one are read by all', async () => {
    const { shared, connectSharedWorker, link } = await boot();
    // Two contract objects with the same layout — like two tabs importing the
    // same declaration module.
    const memA = shared.defineSharedMemory({ flag: shared.field.number() });
    const memB = shared.defineSharedMemory({ flag: shared.field.number() });

    const a = await connectSharedWorker({ port: link(), sharedMemory: memA });
    const b = await connectSharedWorker({ port: link(), sharedMemory: memB });

    expect(b.clientIndex).toBe(2);
    memA.flag.write(7);
    expect(memB.flag.read()).toBe(7);
  });

  it('routes task results only to the requesting client', async () => {
    const { shared, TaskRegistry, connectSharedWorker, link } = await boot();
    const mem = shared.defineSharedMemory({ hits: shared.field.number() });
    TaskRegistry.register({ taskId: 'echo' }, (x: number) => x * 2);

    const a = await connectSharedWorker({ port: link(), sharedMemory: mem });
    const b = await connectSharedWorker({ port: link(), sharedMemory: mem });

    const contract = { taskId: 'echo' };
    const [ra, rb] = await Promise.all([a.runTask(contract, 2), b.runTask(contract, 5)]);
    expect(ra).toBe(4);
    expect(rb).toBe(10);
  });

  it('rejects tasks sent before the handshake', async () => {
    const { link } = await boot();
    const port = link();
    const posted: any[] = [];
    port.addEventListener('message', (e) => {
      posted.push(e.data);
    });
    port.start();
    port.postMessage({ type: 'EXECUTE_TASK', messageId: 'm1', taskId: 'x', args: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(posted[0]).toEqual({ messageId: 'm1', success: false, error: 'Shared memory not initialized in worker.' });
  });

  it('times out when the host never responds', async () => {
    const { connectSharedWorker } = await boot();
    const { port2 } = new MessageChannel(); // no host attached
    const shared = await import('../contract/sharedMemory');
    const mem = shared.defineSharedMemory({ x: shared.field.number() });
    await expect(
      connectSharedWorker({ port: port2, sharedMemory: mem, connectTimeoutMs: 50 })
    ).rejects.toThrow(/timed out/);
  });

  it('rejects when no port, workerUrl, or createWorker is configured', async () => {
    const { shared, connectSharedWorker } = await boot();
    const mem = shared.defineSharedMemory({ n: shared.field.number() });
    await expect(connectSharedWorker({ sharedMemory: mem })).rejects.toThrow(/workerUrl.*createWorker.*port/);
  });

  it('rejects outside a cross-origin isolated context', async () => {
    const { shared, connectSharedWorker, link } = await boot();
    vi.stubGlobal('crossOriginIsolated', false);
    const mem = shared.defineSharedMemory({ n: shared.field.number() });
    await expect(
      connectSharedWorker({ port: link(), sharedMemory: mem })
    ).rejects.toThrow(/cross-origin isolated/);
  });

  it('connects through a createWorker factory', async () => {
    const { shared, connectSharedWorker, link } = await boot();
    const mem = shared.defineSharedMemory({ n: shared.field.number() });
    const client = await connectSharedWorker({
      createWorker: () => ({ port: link() }) as SharedWorker,
      sharedMemory: mem,
    });
    expect(client.clientIndex).toBe(1);
    mem.n.write(11);
    expect(mem.n.read()).toBe(11);
  });

  it('rejects runTask when the host handler throws', async () => {
    const { shared, TaskRegistry, connectSharedWorker, link } = await boot();
    TaskRegistry.register({ taskId: 'boom' }, () => {
      throw new Error('kaboom');
    });
    const mem = shared.defineSharedMemory({ n: shared.field.number() });
    const client = await connectSharedWorker({ port: link(), sharedMemory: mem });
    await expect(client.runTask({ taskId: 'boom' })).rejects.toThrow('kaboom');
  });

  it('skips task names that collide with client members', async () => {
    const { shared, TaskRegistry, connectSharedWorker, link } = await boot();
    TaskRegistry.register({ taskId: 'inc' }, (x: number) => x);
    const mem = shared.defineSharedMemory({ n: shared.field.number() });
    const client = await connectSharedWorker({
      port: link(),
      sharedMemory: mem,
      tasks: { runTask: { taskId: 'inc' }, inc: { taskId: 'inc' } },
    });
    // The collision guard kept the real runTask; the other method installed fine.
    expect(await client.runTask({ taskId: 'inc' }, 4)).toBe(4);
    expect(await client.inc(2)).toBe(2);
  });

  it('disconnect() notifies the host and closes the port', async () => {
    const { shared, connectSharedWorker } = await boot();
    const { attachSharedPort } = await import('./sharedWorkerHost');
    const channel = new MessageChannel();
    attachSharedPort(channel.port1);
    const closeSpy = vi.spyOn(channel.port1, 'close');

    const mem = shared.defineSharedMemory({ n: shared.field.number() });
    const client = await connectSharedWorker({ port: channel.port2, sharedMemory: mem });
    client.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    expect(closeSpy).toHaveBeenCalled();
  });

  it('warns when a later client requests more memory than the first allocated', async () => {
    const { connectSharedWorker } = await boot();
    const { attachSharedPort } = await import('./sharedWorkerHost');
    const { setLogSink } = await import('../log');
    const entries: { message: string }[] = [];
    setLogSink((e) => entries.push(e));
    try {
      // Drive the host with a raw port — the client-side bind of an oversized
      // contract would throw, but the warn happens on the host either way.
      const channel = new MessageChannel();
      attachSharedPort(channel.port1);
      channel.port2.start();
      channel.port2.postMessage({ type: 'SHARED_CONNECT', memoryBytes: 64 });
      await new Promise((r) => setTimeout(r, 50));
      // First client's MemoryManager allocates its 16-page (1MB) default, so
      // the second request must exceed that to hit the capacity warn.
      channel.port2.postMessage({ type: 'SHARED_CONNECT', memoryBytes: 2 << 20 });
      await new Promise((r) => setTimeout(r, 50));
      expect(entries.some((e) => /first client's capacity wins/.test(e.message))).toBe(true);
    } finally {
      setLogSink(null);
    }
  });

  it('sharedWorkerHost() attaches ports delivered via onconnect', async () => {
    const { shared, connectSharedWorker } = await boot();
    const { sharedWorkerHost } = await import('./sharedWorkerHost');
    vi.stubGlobal('self', {} as WorkerGlobalScope);
    sharedWorkerHost();
    const channel = new MessageChannel();
    (globalThis.self as unknown as { onconnect(e: { ports: MessagePort[] }): void })
      .onconnect({ ports: [channel.port1] });

    const mem = shared.defineSharedMemory({ n: shared.field.number() });
    const client = await connectSharedWorker({ port: channel.port2, sharedMemory: mem });
    expect(client.clientIndex).toBe(1);
    mem.n.write(9);
    expect(mem.n.read()).toBe(9);
  });
});
