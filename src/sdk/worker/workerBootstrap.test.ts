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
});
