import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { TaskRegistry } from './worker/registry';
import { SharedSpec, bindSharedMemories, defineSharedMemory, field } from './contract/sharedMemory';
import { WorkerPool } from './pool/workerPool';
import { TaskContract } from './contract/types';

/**
 * A Worker stand-in that runs the same protocol as workerBootstrap — binds
 * shared memory contracts on INIT_MEMORY and runs real TaskRegistry handlers —
 * without spawning OS threads. Everything except the thread boundary is real.
 */
class FakeWorker {
  static created: FakeWorker[] = [];

  public executed: any[] = [];
  public terminated = false;
  private listeners = new Set<(event: { data: any }) => void>();

  constructor(public url: URL, public options: any) {
    FakeWorker.created.push(this);
  }

  postMessage(data: any) {
    queueMicrotask(() => void this.handle(data));
  }

  private async handle(data: any) {
    if (data.type === 'INIT_MEMORY') {
      bindSharedMemories((data.memory as WebAssembly.Memory).buffer as unknown as SharedArrayBuffer);
      return;
    }
    if (data.type === 'EXECUTE_TASK') {
      this.executed.push(data);
      try {
        const result = await TaskRegistry.execute(data.taskId, ...(data.args || []));
        this.emit({ messageId: data.messageId, success: true, result });
      } catch (err: any) {
        this.emit({ messageId: data.messageId, success: false, error: err.message || String(err) });
      }
    }
  }

  private emit(msg: any) {
    for (const listener of this.listeners) listener({ data: msg });
  }

  addEventListener(_type: string, listener: (event: { data: any }) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: { data: any }) => void) {
    this.listeners.delete(listener);
  }

  terminate() {
    this.terminated = true;
  }
}

const makePool = <S extends SharedSpec>(sharedMemory: ReturnType<typeof defineSharedMemory<S>>, poolSize = 2) =>
  new WorkerPool({
    workerUrl: new URL('https://example.test/worker.ts'),
    sharedMemory,
    poolSize,
  });

describe('WorkerPool integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.created = [];
  });

  it('spawns workers, initializes memory, and resolves task results', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const mem = defineSharedMemory({ acc: field.number() });
    const contract: TaskContract<[n: number], number> = { taskId: 'it-add' };
    TaskRegistry.register(contract, (n) => {
      mem.acc.write(mem.acc.read() + n);
      return mem.acc.read();
    });

    const pool = makePool(mem);
    expect(FakeWorker.created).toHaveLength(2);

    await expect(pool.runTask(contract, 5)).resolves.toBe(5);
    await expect(pool.runTask(contract, 7)).resolves.toBe(12);
    expect(mem.acc.read()).toBe(12);
    pool.terminate();
  });

  it('round-robins tasks across workers', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const mem = defineSharedMemory({ n: field.number() });
    const contract: TaskContract<[], number> = { taskId: 'it-rr' };
    TaskRegistry.register(contract, () => 1);

    const pool = makePool(mem, 2);
    await pool.runTask(contract);
    await pool.runTask(contract);

    expect(FakeWorker.created[0].executed).toHaveLength(1);
    expect(FakeWorker.created[1].executed).toHaveLength(1);
    pool.terminate();
  });

  it('rejects runTask when the handler fails, with the worker error message', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const mem = defineSharedMemory({ n: field.number() });
    const contract: TaskContract<[], never> = { taskId: 'it-fail' };
    TaskRegistry.register(contract, () => {
      throw new Error('worker blew up');
    });

    const pool = makePool(mem);
    await expect(pool.runTask(contract)).rejects.toThrow('worker blew up');
    pool.terminate();
  });

  it('enforces contract schemas across the message boundary', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const mem = defineSharedMemory({ n: field.number() });
    const contract: TaskContract<[n: number], number> = {
      taskId: 'it-schema',
      argsSchema: z.tuple([z.number()]),
      resultSchema: z.number(),
    };
    TaskRegistry.register(contract, (n) => n * 2);

    const pool = makePool(mem);
    await expect(pool.runTask(contract, 3)).resolves.toBe(6);
    await expect(pool.runTask(contract, 'bad' as any)).rejects.toThrow();
    pool.terminate();
  });

  it('shares structured fields between main and worker sides', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const mem = defineSharedMemory({
      entities: field.array(512, z.array(z.object({ id: z.number(), x: z.number() }))),
      status: field.string(64),
    });
    const contract: TaskContract<[], number> = { taskId: 'it-tick' };
    TaskRegistry.register(contract, () => {
      const entities = mem.entities.read() ?? [];
      for (const e of entities) e.x += 1;
      mem.entities.write(entities);
      mem.status.write('worker ticked');
      return entities.length;
    });

    const pool = makePool(mem);
    mem.entities.write([{ id: 1, x: 0 }, { id: 2, x: 10 }]);

    await expect(pool.runTask(contract)).resolves.toBe(2);
    expect(mem.entities.read()).toEqual([{ id: 1, x: 1 }, { id: 2, x: 11 }]);
    expect(mem.status.read()).toBe('worker ticked');
    pool.terminate();
  });

  it('terminates all workers', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const mem = defineSharedMemory({ n: field.number() });
    const pool = makePool(mem, 3);
    pool.terminate();
    expect(FakeWorker.created.every((w) => w.terminated)).toBe(true);
  });
});
