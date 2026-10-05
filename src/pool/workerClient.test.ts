// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { connectWorker, resolveWorkerCount, workerClient } from './workerClient';
import { DedicatedWorker } from './dedicatedWorker';
import { WorkerPool } from './workerPool';
import { defineWorker } from '../worker/defineWorker';
import { defineSharedMemory, field } from '../contract/sharedMemory';
import { serviceMethod } from '../service';
import type { TaskRunner } from '../service';
import type { TaskContract } from '../contract/types';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);

/** TaskRunner stub recording every dispatch. */
const stubRunner = () => {
  const calls: { taskId: string; args: unknown[] }[] = [];
  const runner: TaskRunner = {
    runTask<A extends any[], R>(contract: TaskContract<A, R>, ...args: A): Promise<R> {
      calls.push({ taskId: contract.taskId, args });
      return Promise.resolve(`ok:${contract.taskId}` as R);
    },
  };
  return { calls, runner };
};

const mem = defineSharedMemory({ n: field.number() });

const worker = defineWorker({
  sharedMemory: mem,
  methods: {
    greet: (name: string) => `hi ${name}`,
    unit: serviceMethod({
      def: { argsSchema: z.tuple([z.number()]), resultSchema: z.number() },
      run: (n) => n + 1,
    }),
  },
  services: {
    math: { add: (a: number, b: number) => a + b },
  },
});
type W = typeof worker;

describe('workerClient', () => {
  it('dispatches flat methods under their own taskId', async () => {
    const { calls, runner } = stubRunner();
    const client = workerClient<W>(runner);
    await expect(client.greet('bo')).resolves.toBe('ok:greet');
    expect(calls).toEqual([{ taskId: 'greet', args: ['bo'] }]);
  });

  it('dispatches nested service methods under `svc.method`', async () => {
    const { calls, runner } = stubRunner();
    const client = workerClient<W>(runner);
    await client.math.add(1, 2);
    expect(calls).toEqual([{ taskId: 'math.add', args: [1, 2] }]);
  });

  it('is not a thenable — `then` is undefined and `await` does not hang', async () => {
    const client = workerClient<W>(stubRunner().runner);
    expect((client as Record<string, unknown>).then).toBeUndefined();
    await expect(Promise.resolve(client)).resolves.toBe(client);
  });

  it('resolves the runner factory lazily', async () => {
    const { calls, runner } = stubRunner();
    const factory = vi.fn(() => runner);
    const client = workerClient<W>(factory);
    expect(factory).not.toHaveBeenCalled();
    await client.greet('x');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it('rejects wrong arg types at compile time', () => {
    const client = workerClient<W>(stubRunner().runner);
    // @ts-expect-error — greet takes a string
    void client.greet(42);
    // @ts-expect-error — math.add takes two numbers
    void client.math.add('1');
    expect(client).toBeTruthy();
  });

  it('defineWorker rejects reserved method names at compile AND run time', () => {
    expect(() =>
      defineWorker({
        // @ts-expect-error — 'terminate' collides with the client API
        methods: { terminate: () => {} },
      }),
    ).toThrow(/reserved/);
  });
});

describe('connectWorker', () => {
  const cfg = {
    sharedMemory: mem,
    worker: () => new Worker(new URL('./x.worker.ts', import.meta.url)),
    poolSize: 1,
  } as const;

  it('stays lazy: pool is null until the first call', async () => {
    const before = InProcessWorker.created.length;
    const client = connectWorker<W>({ ...cfg });
    expect(client.pool).toBeNull();
    expect(InProcessWorker.created.length).toBe(before);

    client.start();
    expect(client.pool).not.toBeNull();
    expect(InProcessWorker.created.length).toBe(before + 1);
    client.terminate();
  });

  it('spawned eagerly with lazy: false', () => {
    const client = connectWorker<W>({ ...cfg, lazy: false });
    expect(client.pool).not.toBeNull();
    client.terminate();
    expect(client.pool).toBeNull();
  });

  it('terminate() drops the pool and the next call re-spawns it', async () => {
    InProcessWorker.handlerModules = [() => Promise.resolve()];
    const client = connectWorker<W>({ ...cfg });
    await client.greet('a').catch(() => {}); // force spawn (handler may 404 — irrelevant)
    expect(client.pool).not.toBeNull();
    client.terminate();
    expect(client.pool).toBeNull();
    await client.greet('b').catch(() => {});
    expect(client.pool).not.toBeNull();
    client.terminate();
  });
});

describe('connectWorker — worker count', () => {
  const base = {
    sharedMemory: mem,
    worker: () => new Worker(new URL('./x.worker.ts', import.meta.url)),
    lazy: false,
  } as const;

  it('defaults to one dedicated worker (no pool)', () => {
    const client = connectWorker<W>({ ...base });
    expect(client.pool).toBeInstanceOf(DedicatedWorker);
    client.terminate();
  });

  it('builds a pool when workers > 1', () => {
    const client = connectWorker<W>({ ...base, workers: 2 });
    expect(client.pool).toBeInstanceOf(WorkerPool);
    expect(client.pool!.workers).toHaveLength(2);
    client.terminate();
  });

  it('honors the deprecated poolSize alias', () => {
    const one = connectWorker<W>({ ...base, poolSize: 1 });
    const three = connectWorker<W>({ ...base, poolSize: 3 });
    expect(one.pool).toBeInstanceOf(DedicatedWorker);
    expect(three.pool!.workers).toHaveLength(3);
    one.terminate();
    three.terminate();
  });

  it('workers wins over poolSize', () => {
    const client = connectWorker<W>({ ...base, workers: 1, poolSize: 4 });
    expect(client.pool).toBeInstanceOf(DedicatedWorker);
    client.terminate();
  });
});

describe('resolveWorkerCount', () => {
  it('defaults to 1, floors, and clamps to at least 1', () => {
    expect(resolveWorkerCount(undefined)).toBe(1);
    expect(resolveWorkerCount(2.9)).toBe(2);
    expect(resolveWorkerCount(0)).toBe(1);
  });

  it("resolves 'auto' from navigator.hardwareConcurrency", () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 6 });
    expect(resolveWorkerCount('auto')).toBe(6);
    vi.unstubAllGlobals();
    vi.stubGlobal('Worker', InProcessWorker);
  });
});
