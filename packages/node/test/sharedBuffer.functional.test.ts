/**
 * Functional test for withSharedBuffer/bindSharedBuffer over REAL
 * node:worker_threads — the fixture worker loads the actual sharedBuffer.ts
 * (type-stripped by Node) and '@atolljs/core' via the aliasCore.mjs loader
 * hook, so the shared buffer lands in a genuine separate thread. A field the
 * worker writes is read back here through the main thread's own contract —
 * true shared memory, not a message copy.
 */
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import { defineSharedMemory, field } from '@atolljs/core';
import { withSharedBuffer } from '../src/sharedBuffer';

const fixture = fileURLToPath(new URL('./fixtures/sharedBuffer.worker.mjs', import.meta.url));
// On Windows --import requires a file:// URL, not a bare path.
const aliasLoader = new URL('./fixtures/aliasCore.mjs', import.meta.url).href;

const spawnWorker = (workerData?: unknown) =>
  new NodeWorker(fixture, { workerData, execArgv: ['--import', aliasLoader] });

const makeMemory = () =>
  defineSharedMemory({ probe: field.number(), label: field.string({ maxBytes: 64 }) });

const bind = (memory: ReturnType<typeof makeMemory>) => {
  memory.bind(new SharedArrayBuffer(memory.totalBytes));
  return memory;
};

const nextMessage = (worker: NodeWorker) =>
  new Promise<{ type: string; error?: string }>((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });

describe('bindSharedBuffer (real worker thread)', () => {
  it('binds workerData.buffer directly — worker writes, main thread reads', async () => {
    const memory = bind(makeMemory());
    const worker = spawnWorker({ buffer: memory.buffer });
    try {
      await expect(nextMessage(worker)).resolves.toEqual({ type: 'BOUND' });
      // Fields written inside the worker are readable through the main
      // thread's contract — the buffers are the same memory.
      expect(memory.probe.read()).toBe(1337);
      expect(memory.label.read()).toBe('bound-in-worker');
    } finally {
      await worker.terminate();
    }
  });

  it('withSharedBuffer delivers the buffer over the message channel', async () => {
    const memory = bind(makeMemory());
    const spawn = withSharedBuffer(() => spawnWorker(), memory.buffer);
    const worker = spawn() as NodeWorker;
    try {
      await expect(nextMessage(worker)).resolves.toEqual({ type: 'BOUND' });
      expect(memory.probe.read()).toBe(1337);
      expect(memory.label.read()).toBe('bound-in-worker');
    } finally {
      await worker.terminate();
    }
  });

  it('a buffer thunk is evaluated per spawn — both workers bind', async () => {
    const memory = bind(makeMemory());
    const thunk = vi.fn(() => memory.buffer);
    const spawn = withSharedBuffer(() => spawnWorker(), thunk);
    const a = spawn() as NodeWorker;
    const b = spawn() as NodeWorker;
    // Attach both listeners before awaiting — worker→parent 'message' events
    // are emitted on delivery and dropped if no listener is attached yet.
    const aMsg = nextMessage(a);
    const bMsg = nextMessage(b);
    try {
      await expect(aMsg).resolves.toEqual({ type: 'BOUND' });
      await expect(bMsg).resolves.toEqual({ type: 'BOUND' });
      expect(thunk).toHaveBeenCalledTimes(2);
    } finally {
      await Promise.all([a.terminate(), b.terminate()]);
    }
  });

  it('an unresolved buffer posts empty — the worker rejects loudly', async () => {
    const spawn = withSharedBuffer(() => spawnWorker(), () => undefined);
    const worker = spawn() as NodeWorker;
    try {
      const msg = await nextMessage(worker);
      expect(msg.type).toBe('BIND_FAILED');
      expect(msg.error).toMatch(/sent an empty buffer/);
    } finally {
      await worker.terminate();
    }
  });

  it('times out when no buffer ever arrives', async () => {
    // No buffer anywhere — workerData only carries the (short) timeout.
    const worker = spawnWorker({ timeout: 50 });
    try {
      const msg = await nextMessage(worker);
      expect(msg.type).toBe('BIND_FAILED');
      expect(msg.error).toMatch(/no shared buffer arrived within 50ms/);
    } finally {
      await worker.terminate();
    }
  });
});
