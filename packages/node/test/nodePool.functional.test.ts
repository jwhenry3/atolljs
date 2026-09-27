import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defineSharedMemory, field, type TaskContract } from '@jwhenry123/mesh/sdk';
import { createNodePool } from '../src/pool';
import { createNodeWorker } from '../src/worker';

const fixture = fileURLToPath(new URL('../../../test/fixtures/meshProtocol.worker.mjs', import.meta.url));

const counterMemory = () => defineSharedMemory({ counter: field.number() });

describe('createNodePool', () => {
  it('throws without workerFile or createWorker', () => {
    expect(() => createNodePool({ sharedMemory: counterMemory() } as any)).toThrow(/workerFile or createWorker/);
  });

  it('runs tasks on real worker threads and shares memory back', async () => {
    const mem = counterMemory();
    const pool = createNodePool({ workerFile: fixture, sharedMemory: mem, poolSize: 2 });
    try {
      // EXECUTE_TASK round-trip on a real thread
      const thread = await pool.runTask({ taskId: 't-thread' } as TaskContract<[], number>);
      expect(thread).toBeGreaterThan(0); // threadId 0 would be the main thread

      // Shared-memory writes from the worker side are visible here
      await expect(pool.runTask({ taskId: 't-bump' } as TaskContract<[number], number>, 5)).resolves.toBe(5);
      await expect(pool.runTask({ taskId: 't-bump' } as TaskContract<[number], number>, 7)).resolves.toBe(12);
      expect(mem.counter.read()).toBe(12);

      // Worker error surfaces as a rejected promise
      await expect(pool.runTask({ taskId: 't-fail' })).rejects.toThrow('fixture worker exploded');
    } finally {
      pool.terminate();
    }
  });

  it('honors a custom createWorker factory', async () => {
    const mem = counterMemory();
    const pool = createNodePool({
      sharedMemory: mem,
      poolSize: 1,
      createWorker: () => createNodeWorker(fixture),
    });
    try {
      await expect(pool.runTask({ taskId: 't-echo' } as TaskContract<[string], string>, 'hi')).resolves.toBe('hi');
    } finally {
      pool.terminate();
    }
  });
});
