import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type FakeSelf = {
  onmessage?: (event: { data: any }) => Promise<void>;
  postMessage: (msg: any) => void;
};

const makeWasmMemory = () =>
  new WebAssembly.Memory({ initial: 16, maximum: 64, shared: true });

/**
 * Boots the real workerBootstrap module against a fake `self`, with fresh
 * module state per test so memory/registry state doesn't leak between tests.
 */
async function boot() {
  vi.resetModules();
  const posted: any[] = [];
  const fakeSelf: FakeSelf = { postMessage: (msg) => posted.push(msg) };
  vi.stubGlobal('self', fakeSelf);

  const shared = await import('../contract/sharedMemory');
  const { TaskRegistry } = await import('./registry');
  await import('./workerBootstrap');
  return { posted, fakeSelf, shared, TaskRegistry };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workerBootstrap', () => {
  it('binds shared memory contracts on INIT_MEMORY and executes tasks', async () => {
    const { posted, fakeSelf, shared, TaskRegistry } = await boot();
    const mem = shared.defineSharedMemory({ counter: shared.field.number() });
    TaskRegistry.register({ taskId: 'inc' }, (x: number) => {
      mem.counter.write(mem.counter.read() + x);
      return mem.counter.read();
    });

    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm1', taskId: 'inc', args: [5] } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm2', taskId: 'inc', args: [3] } });

    expect(posted).toEqual([
      { messageId: 'm1', success: true, result: 5 },
      { messageId: 'm2', success: true, result: 8 },
    ]);
  });

  it('rejects EXECUTE_TASK before INIT_MEMORY', async () => {
    const { posted, fakeSelf } = await boot();
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm1', taskId: 'x', args: [] } });
    expect(posted[0].success).toBe(false);
    expect(posted[0].error).toMatch(/not initialized/);
  });

  it('returns an error result for unknown task ids', async () => {
    const { posted, fakeSelf } = await boot();
    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm1', taskId: 'ghost', args: [] } });
    expect(posted[0].success).toBe(false);
    expect(posted[0].error).toMatch(/not found/);
  });

  it('returns an error result when args fail the contract schema', async () => {
    const { posted, fakeSelf, TaskRegistry } = await boot();
    TaskRegistry.register(
      { taskId: 'typed', argsSchema: z.tuple([z.number()]) },
      (n: number) => n
    );
    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm1', taskId: 'typed', args: ['bad'] } });
    expect(posted[0].success).toBe(false);
    expect(posted[0].error).toBeTruthy();
  });

  it('returns an error result when the handler throws', async () => {
    const { posted, fakeSelf, TaskRegistry } = await boot();
    TaskRegistry.register({ taskId: 'boom' }, () => {
      throw new Error('kaboom');
    });
    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm1', taskId: 'boom', args: [] } });
    expect(posted[0]).toEqual({ messageId: 'm1', success: false, error: 'kaboom' });
  });

  it('ignores messages with unknown types', async () => {
    const { posted, fakeSelf } = await boot();
    await fakeSelf.onmessage!({ data: { type: 'PING' } });
    await fakeSelf.onmessage!({ data: {} });
    expect(posted).toEqual([]);
  });

  it('invokes the handler with zero args when `args` is omitted', async () => {
    const { posted, fakeSelf, TaskRegistry } = await boot();
    let seen: unknown[] | null = null;
    TaskRegistry.register({ taskId: 'noargs' }, (...rest: unknown[]) => {
      seen = rest;
      return 'ok';
    });
    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 7, taskId: 'noargs' } });
    expect(seen).toEqual([]);
    expect(posted[0]).toEqual({ messageId: 7, success: true, result: 'ok' });
  });

  it('serializes non-Error rejections via String(err)', async () => {
    const { posted, fakeSelf, TaskRegistry } = await boot();
    TaskRegistry.register({ taskId: 'str' }, () => Promise.reject('plain failure'));
    TaskRegistry.register({ taskId: 'num' }, () => Promise.reject(42));
    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm1', taskId: 'str', args: [] } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm2', taskId: 'num', args: [] } });
    expect(posted[0]).toEqual({ messageId: 'm1', success: false, error: 'plain failure' });
    expect(posted[1]).toEqual({ messageId: 'm2', success: false, error: '42' });
  });

  it('returns an error result when the result fails the contract schema', async () => {
    const { posted, fakeSelf, TaskRegistry } = await boot();
    TaskRegistry.register(
      { taskId: 'badresult', resultSchema: z.number() },
      () => 'not a number' as unknown as number
    );
    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm1', taskId: 'badresult', args: [] } });
    expect(posted[0].success).toBe(false);
    expect(posted[0].error).toBeTruthy();
  });

  it('posts `result: undefined` for void tasks', async () => {
    const { posted, fakeSelf, TaskRegistry } = await boot();
    TaskRegistry.register({ taskId: 'void' }, () => {});
    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm1', taskId: 'void', args: [] } });
    expect(posted[0]).toEqual({ messageId: 'm1', success: true, result: undefined });
  });

  it('runs concurrent EXECUTE_TASK messages independently, keyed by messageId', async () => {
    const { posted, fakeSelf, TaskRegistry } = await boot();
    const release = new Map<string, (v: unknown) => void>();
    TaskRegistry.register({ taskId: 'deferred' }, (key: string) =>
      new Promise((resolve) => release.set(key, resolve))
    );
    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } });

    // Fire both dispatches without awaiting — they run concurrently.
    const p1 = fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'a', taskId: 'deferred', args: ['first'] } });
    const p2 = fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'b', taskId: 'deferred', args: ['second'] } });

    // Resolve out of order — each messageId must map to its own result.
    release.get('second')!('done-second');
    release.get('first')!('done-first');
    await Promise.all([p1, p2]);

    expect(posted).toContainEqual({ messageId: 'b', success: true, result: 'done-second' });
    expect(posted).toContainEqual({ messageId: 'a', success: true, result: 'done-first' });
  });

  it('keeps tasks rejected when INIT_MEMORY binding fails (undersized buffer)', async () => {
    const { posted, fakeSelf, shared, TaskRegistry } = await boot();
    // 2MB field vs the 1MB fake buffer — bind() throws, the flag stays false.
    shared.defineSharedMemory({ huge: shared.field.string({ maxBytes: 2 * 1024 * 1024 }) });
    TaskRegistry.register({ taskId: 'noop' }, () => 'ok');

    await expect(
      fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } })
    ).rejects.toThrow(RangeError);

    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'm1', taskId: 'noop', args: [] } });
    expect(posted[0]).toEqual({
      messageId: 'm1',
      success: false,
      error: 'Shared memory not initialized in worker.',
    });
  });

  it('rebinds contracts to the new buffer on a second INIT_MEMORY', async () => {
    const { posted, fakeSelf, shared, TaskRegistry } = await boot();
    const mem = shared.defineSharedMemory({ counter: shared.field.number() });
    TaskRegistry.register({ taskId: 'read' }, () => mem.counter.read());
    TaskRegistry.register({ taskId: 'bump' }, () => mem.counter.write(mem.counter.read() + 1));

    const buf1 = makeWasmMemory();
    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: buf1 } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'w1', taskId: 'bump', args: [] } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'r1', taskId: 'read', args: [] } });
    expect(posted.at(-1)).toEqual({ messageId: 'r1', success: true, result: 1 });

    // A fresh buffer starts zeroed — reads must come from the NEW binding.
    await fakeSelf.onmessage!({ data: { type: 'INIT_MEMORY', memory: makeWasmMemory() } });
    await fakeSelf.onmessage!({ data: { type: 'EXECUTE_TASK', messageId: 'r2', taskId: 'read', args: [] } });
    expect(posted.at(-1)).toEqual({ messageId: 'r2', success: true, result: 0 });
  });
});
