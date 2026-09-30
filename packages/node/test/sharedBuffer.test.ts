/**
 * Unit tests for sharedBuffer.ts. `withSharedBuffer` runs on the main thread
 * and is exercised with a fake worker; `bindSharedBuffer` is worker-side, so
 * node:worker_threads is mocked with a controllable
 * isMainThread / parentPort / workerData triple — the function reads all three
 * at call time, so per-test mutation works. The end-to-end wire path (real
 * worker_threads + real SharedArrayBuffer) lives in
 * sharedBuffer.functional.test.ts.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineSharedMemory, field } from '@atolljs/core';
import { bindSharedBuffer, withSharedBuffer } from '../src/sharedBuffer';

const thread = vi.hoisted(() => ({
  isMainThread: true,
  parentPort: null as (EventEmitter & { postMessage?: unknown }) | null,
  workerData: null as { buffer?: SharedArrayBuffer } | null,
}));

vi.mock('node:worker_threads', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:worker_threads')>();
  return {
    ...original,
    get isMainThread() {
      return thread.isMainThread;
    },
    get parentPort() {
      return thread.parentPort;
    },
    get workerData() {
      return thread.workerData;
    },
  };
});

const fakeWorker = () => ({ postMessage: vi.fn() });

describe('withSharedBuffer', () => {
  it('posts the SHARED_BUFFER message with a direct buffer on each spawn', () => {
    const buffer = new SharedArrayBuffer(64);
    const worker = fakeWorker();
    const spawn = withSharedBuffer(() => worker as any, buffer);
    expect(spawn()).toBe(worker);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SHARED_BUFFER', buffer });
  });

  it('evaluates a buffer thunk per spawn — respawns get the current buffer', () => {
    const first = new SharedArrayBuffer(8);
    const second = new SharedArrayBuffer(16);
    const thunk = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const workers = [fakeWorker(), fakeWorker()];
    let i = 0;
    const spawn = withSharedBuffer(() => workers[i++] as any, thunk);

    spawn();
    spawn();

    expect(thunk).toHaveBeenCalledTimes(2);
    expect(workers[0].postMessage).toHaveBeenCalledWith({ type: 'SHARED_BUFFER', buffer: first });
    expect(workers[1].postMessage).toHaveBeenCalledWith({ type: 'SHARED_BUFFER', buffer: second });
  });

  it('still posts when the thunk yields no buffer — worker fails loudly', () => {
    const worker = fakeWorker();
    const spawn = withSharedBuffer(() => worker as any, () => undefined);
    spawn();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SHARED_BUFFER', buffer: undefined });
  });
});

describe('bindSharedBuffer', () => {
  beforeEach(() => {
    thread.isMainThread = true;
    thread.parentPort = null;
    thread.workerData = null;
  });

  it('rejects when called on the main thread', async () => {
    await expect(bindSharedBuffer(50)).rejects.toThrow(/must be called inside a worker/);
  });

  it('binds immediately from workerData.buffer — contracts become readable', async () => {
    const memory = defineSharedMemory({ probe: field.number() });
    const buffer = new SharedArrayBuffer(memory.totalBytes);
    thread.isMainThread = false;
    thread.workerData = { buffer };

    await expect(bindSharedBuffer()).resolves.toBe(buffer);
    // bindSharedMemories ran — the contract is bound on "this thread".
    memory.probe.write(42);
    expect(memory.probe.read()).toBe(42);
  });

  it('resolves when the SHARED_BUFFER message lands on parentPort', async () => {
    const memory = defineSharedMemory({ probe: field.number() });
    const buffer = new SharedArrayBuffer(memory.totalBytes);
    thread.isMainThread = false;
    thread.parentPort = new EventEmitter();

    const pending = bindSharedBuffer(5_000);
    // Unrelated traffic is ignored while waiting.
    thread.parentPort.emit('message', { type: 'EXECUTE_TASK' });
    thread.parentPort.emit('message', { type: 'SHARED_BUFFER', buffer });

    await expect(pending).resolves.toBe(buffer);
    memory.probe.write(7);
    expect(memory.probe.read()).toBe(7);
  });

  it('rejects when the producing side sent an empty buffer', async () => {
    thread.isMainThread = false;
    thread.parentPort = new EventEmitter();

    const pending = bindSharedBuffer(5_000);
    const assertion = expect(pending).rejects.toThrow(/sent an empty buffer/);
    thread.parentPort.emit('message', { type: 'SHARED_BUFFER', buffer: undefined });
    await assertion;
  });

  it('rejects after timeoutMs when no buffer arrives', async () => {
    thread.isMainThread = false;
    thread.parentPort = new EventEmitter();

    // The timer under test IS the timeout mechanism — no fixed sleeps.
    await expect(bindSharedBuffer(25)).rejects.toThrow(
      /no shared buffer arrived within 25ms/,
    );
  });
});

describe('package index', () => {
  it('re-exports the shared-buffer surface', async () => {
    const mod = await import('../src/index');
    expect(mod.withSharedBuffer).toBe(withSharedBuffer);
    expect(mod.bindSharedBuffer).toBe(bindSharedBuffer);
  });
});
