// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { connectSubWorker } from './subWorkerClient';
import { WorkerPool } from './workerPool';
import { defineWorker } from '../worker/defineWorker';
import { defineSharedMemory, field } from '../contract/sharedMemory';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);

// Contracts are process-global: every defineSharedMemory in this file binds
// whenever bindSharedMemories runs — size buffers to fit them all.
const shellMem = defineSharedMemory({ tally: field.number() });
const privateMem = defineSharedMemory({ acc: field.number() });

const subWorker = defineWorker({
  sharedMemory: shellMem,
  methods: {
    bump: (n: number) => {
      shellMem.tally.write(shellMem.tally.read() + n);
      return shellMem.tally.read();
    },
    fan: (n: number) => n * 2,
  },
});
const privateWorker = defineWorker({
  sharedMemory: privateMem,
  methods: {
    save: (n: number) => {
      privateMem.acc.write(n);
      return privateMem.acc.read();
    },
  },
});
type SW = typeof subWorker;
type PW = typeof privateWorker;

const spawnInProc = () => new Worker(new URL('./x.ts', import.meta.url));

describe('connectSubWorker', () => {
  it('dispatches methods to the nested pool like a normal client', async () => {
    const sub = connectSubWorker<SW>({ worker: spawnInProc, poolSize: 2 });
    await expect(sub.fan(21)).resolves.toBe(42);
    expect(sub.pool).not.toBeNull();
    sub.terminate();
  });

  it('sharedBuffer: sub-workers bind the shell worker’s existing buffer', async () => {
    // Simulate the shell: the contract is already bound to a buffer that
    // arrived over the shell's own INIT_MEMORY.
    const buf = new SharedArrayBuffer(1 << 16);
    shellMem.bind(buf);

    const sub = connectSubWorker<SW>({
      worker: spawnInProc,
      sharedMemory: shellMem,
      sharedBuffer: buf,
      poolSize: 1,
    });
    try {
      // A task running "inside the sub-worker" writes through the shared
      // buffer; the shell-side connector sees it — three tiers, one buffer.
      await expect(sub.bump(9)).resolves.toBe(9);
      expect(shellMem.tally.read()).toBe(9);
      // No fresh allocation — the same bytes the shell is bound to.
      expect(sub.pool!.sharedBuffer).toBe(buf);
    } finally {
      sub.terminate();
    }
  });

  it('sharedBuffer accepts a thunk resolved once at pool construction', async () => {
    const buf = new SharedArrayBuffer(1 << 16);
    const thunk = vi.fn(() => buf);
    const sub = connectSubWorker<SW>({
      worker: spawnInProc,
      sharedBuffer: thunk,
      poolSize: 2,
      lazy: false,
    });
    expect(thunk).toHaveBeenCalledTimes(1); // once — not per spawned worker
    expect(sub.pool!.sharedBuffer).toBe(buf);
    sub.terminate();
  });

  it('no sharedBuffer: the sub-pool allocates its own buffer for its contract', async () => {
    const sub = connectSubWorker<PW>({
      worker: spawnInProc,
      sharedMemory: privateMem,
      poolSize: 1,
    });
    try {
      await expect(sub.save(7)).resolves.toBe(7);
      expect(privateMem.acc.read()).toBe(7);
      expect(sub.pool!.sharedBuffer).toBeInstanceOf(SharedArrayBuffer);
    } finally {
      sub.terminate();
    }
  });

  it('rejects an empty sharedBuffer thunk result at spawn', () => {
    const sub = connectSubWorker<SW>({
      worker: spawnInProc,
      sharedBuffer: () => undefined,
      poolSize: 1,
    });
    // Lazy spawn — the config error surfaces on first use.
    expect(() => sub.start()).toThrow(/empty buffer/);
  });

  it('URL configs throw a clear error where nested workers do not exist', () => {
    vi.stubGlobal('Worker', undefined);
    try {
      const sub = connectSubWorker<SW>({ worker: new URL('https://t.test/sub.js') });
      expect(() => sub.start()).toThrow(/no `Worker` global/);
    } finally {
      vi.stubGlobal('Worker', InProcessWorker);
    }
  });

  it('sharedBuffer alone ships memory without a local contract binding', async () => {
    const buf = new SharedArrayBuffer(1 << 16);
    const pool = new WorkerPool({
      createWorker: spawnInProc,
      sharedBuffer: buf,
      poolSize: 1,
    });
    expect(pool.sharedBuffer).toBe(buf);
    // The (stubbed) sub-worker still received INIT_MEMORY with the buffer —
    // visible in what InProcessWorker bound: every defined contract now
    // points at buf, so privateMem reads/writes land there too.
    privateMem.acc.write(3);
    expect(privateMem.acc.read()).toBe(3);
    pool.terminate();
  });
});
