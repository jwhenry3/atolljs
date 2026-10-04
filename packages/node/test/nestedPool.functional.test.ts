/**
 * Functional test for nested pools over REAL node:worker_threads: a worker
 * shell (nestedShell.worker.mjs) hosts a genuine WorkerPool of sub-workers
 * (nestedSub.worker.mjs) bound to the SAME shared buffer via `sharedBuffer`
 * — three tiers, one counter.
 *
 * Requires `vite build` (core lib) to have run — see aliasCore.mjs.
 */
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { defineSharedMemory, field, type TaskContract } from '@atolljs/core';
import { createNodePool } from '../src/pool';

const fixture = fileURLToPath(new URL('../../../test/fixtures/nestedShell.worker.mjs', import.meta.url));
// On Windows --import requires a file:// URL, not a bare path.
const aliasLoader = new URL('./fixtures/aliasCore.mjs', import.meta.url).href;

const counterMemory = () => defineSharedMemory({ counter: field.number() });

describe('nested pools (worker shell → sub-workers)', () => {
  it('fans out from a worker into sub-workers on the same buffer', async () => {
    const mem = counterMemory();
    const pool = createNodePool({
      worker: () => new NodeWorker(fixture, { execArgv: ['--import', aliasLoader] }),
      sharedMemory: mem,
      poolSize: 1,
    });
    try {
      // Three tiers: the fan-out ran on a real sub-thread distinct from
      // both the main thread and the shell worker.
      const fanout = await pool.runTask({ taskId: 'shell-fanout' } as TaskContract<[], { shell: number; sub: number }>);
      expect(fanout.shell).toBeGreaterThan(0);
      expect(fanout.sub).toBeGreaterThan(0);
      expect(fanout.sub).not.toBe(fanout.shell);

      // The sub-worker wrote through the sharedBuffer — the same bytes the
      // main-side contract is bound to.
      await expect(pool.runTask({ taskId: 'shell-bump' } as TaskContract<[number], number>, 9)).resolves.toBe(9);
      expect(mem.counter.read()).toBe(9);
    } finally {
      pool.terminate();
    }
  });
});
