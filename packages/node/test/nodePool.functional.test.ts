import { fileURLToPath } from 'node:url';
import { threadId, Worker as NodeWorker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { defineSharedMemory, field, TaskRegistry, type TaskContract } from '@jwhenry123/mesh/sdk';
import { createNodePool } from '../src/pool';
import { createNodeWorker } from '../src/worker';
import { InProcessWorker } from '@jwhenry123/mesh/sdk/testing/inProcessWorker';

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

  it('accepts a file path via the worker spec, identical to workerFile', async () => {
    const mem = counterMemory();
    const pool = createNodePool({ worker: fixture, sharedMemory: mem, poolSize: 1 });
    try {
      await expect(pool.runTask({ taskId: 't-echo' } as TaskContract<[string], string>, 'yo')).resolves.toBe('yo');
    } finally {
      pool.terminate();
    }
  });

  it('adapts a node:worker_threads Worker returned by a worker factory', async () => {
    const mem = counterMemory();
    const pool = createNodePool({
      worker: () => new NodeWorker(fixture),
      sharedMemory: mem,
      poolSize: 1,
    });
    try {
      const thread = await pool.runTask({ taskId: 't-thread' } as TaskContract<[], number>);
      expect(thread).toBeGreaterThan(0); // really ran on a spawned thread
    } finally {
      pool.terminate();
    }
  });

  it('passes DOM-style workers through unchanged', async () => {
    InProcessWorker.created = [];
    TaskRegistry.register({ taskId: 'in-proc' } as TaskContract<[], number>, () => threadId);
    const mem = counterMemory();
    const pool = createNodePool({
      worker: () => new InProcessWorker(new URL('https://t.test/w.js')) as unknown as Worker,
      sharedMemory: mem,
      poolSize: 1,
    });
    try {
      // The un-adapted InProcessWorker handles the protocol in-process.
      await expect(pool.runTask({ taskId: 'in-proc' } as TaskContract<[], number>)).resolves.toBe(0);
      expect(InProcessWorker.created).toHaveLength(1);
    } finally {
      pool.terminate();
    }
  });
});
