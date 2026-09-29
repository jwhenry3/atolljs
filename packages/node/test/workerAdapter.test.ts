import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Worker as NodeWorker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { NodeWorkerAdapter, createNodeWorker } from '../src/worker';

/** EventEmitter stand-in for node:worker_threads.Worker. */
const fakeWorker = () => {
  const ee = new EventEmitter();
  return Object.assign(ee, {
    postMessage: vi.fn(),
    terminate: vi.fn(async () => 0),
  }) as unknown as NodeWorker;
};

describe('NodeWorkerAdapter', () => {
  it('forwards postMessage to the underlying worker', () => {
    const w = fakeWorker();
    const adapter = new NodeWorkerAdapter(w);
    const msg = { type: 'EXECUTE_TASK', taskId: 'x' };
    adapter.postMessage(msg);
    expect(w.postMessage).toHaveBeenCalledWith(msg);
  });

  it('wraps message events into { data } — the DOM surface', () => {
    const w = fakeWorker();
    const adapter = new NodeWorkerAdapter(w);
    const got: unknown[] = [];
    adapter.addEventListener('message', (e) => got.push(e.data));
    w.emit('message', { hello: 'world' });
    expect(got).toEqual([{ hello: 'world' }]);
  });

  it('removeEventListener detaches the exact wrapped listener', () => {
    const w = fakeWorker();
    const adapter = new NodeWorkerAdapter(w);
    const got: unknown[] = [];
    const handler = (e: { data: unknown }) => got.push(e.data);
    adapter.addEventListener('message', handler);
    adapter.removeEventListener('message', handler);
    w.emit('message', 'ignored');
    expect(got).toEqual([]);
    expect(w.listenerCount('message')).toBe(0);
  });

  it('only detaches the removed listener when several are installed', () => {
    const w = fakeWorker();
    const adapter = new NodeWorkerAdapter(w);
    const a: unknown[] = [], b: unknown[] = [];
    const hA = (e: { data: unknown }) => a.push(e.data);
    const hB = (e: { data: unknown }) => b.push(e.data);
    adapter.addEventListener('message', hA);
    adapter.addEventListener('message', hB);
    adapter.removeEventListener('message', hA);
    w.emit('message', 1);
    expect(a).toEqual([]);
    expect(b).toEqual([1]);
  });

  it('forwards Node error events to error listeners', () => {
    const w = fakeWorker();
    const adapter = new NodeWorkerAdapter(w);
    const got: unknown[] = [];
    adapter.addEventListener('error', (e) => got.push(e));
    w.emit('error', new Error('kaboom'));
    expect(got).toHaveLength(1);
    expect((got[0] as { type: string }).type).toBe('error');
    expect((got[0] as { message: string }).message).toBe('kaboom');
  });

  it('forwards nonzero exit as an error event but ignores exit(0)', () => {
    const w = fakeWorker();
    const adapter = new NodeWorkerAdapter(w);
    const got: unknown[] = [];
    adapter.addEventListener('error', (e) => got.push(e));
    w.emit('exit', 0);
    expect(got).toEqual([]);
    w.emit('exit', 1);
    expect(got).toHaveLength(1);
    expect((got[0] as { message: string }).message).toMatch(/exit/);
  });

  it('removeEventListener detaches error and exit listeners', () => {
    const w = fakeWorker();
    const adapter = new NodeWorkerAdapter(w);
    const got: unknown[] = [];
    const handler = (e: unknown) => got.push(e);
    adapter.addEventListener('error', handler);
    adapter.removeEventListener('error', handler);
    expect(w.listenerCount('error')).toBe(0);
    expect(w.listenerCount('exit')).toBe(0);
    w.emit('exit', 1); // emitting 'error' with no listeners throws on EventEmitter
    expect(got).toEqual([]);
  });

  it('forwards terminate', () => {
    const w = fakeWorker();
    new NodeWorkerAdapter(w).terminate();
    expect(w.terminate).toHaveBeenCalled();
  });
});

describe('createNodeWorker', () => {
  it('spawns a worker thread from a file path', async () => {
    const fixture = fileURLToPath(new URL('../../../test/fixtures/atollProtocol.worker.mjs', import.meta.url));
    const worker = createNodeWorker(fixture);
    try {
      const done = new Promise<unknown>((resolve) =>
        worker.addEventListener('message', (e) => resolve((e as any).data))
      );
      worker.postMessage({ type: 'EXECUTE_TASK', messageId: 1, taskId: 't-echo', args: [42] });
      await expect(done).resolves.toEqual({ messageId: 1, success: true, result: 42 });
    } finally {
      worker.terminate();
    }
  });

  it('wraps an already-constructed Worker (bundler-detectable form)', async () => {
    const fixture = fileURLToPath(new URL('../../../test/fixtures/atollProtocol.worker.mjs', import.meta.url));
    const nodeWorker = new NodeWorker(fixture);
    const adapted = createNodeWorker(nodeWorker);
    try {
      const done = new Promise<unknown>((resolve) =>
        adapted.addEventListener('message', (e) => resolve((e as any).data))
      );
      adapted.postMessage({ type: 'EXECUTE_TASK', messageId: 1, taskId: 't-echo', args: ['hi'] });
      await expect(done).resolves.toEqual({ messageId: 1, success: true, result: 'hi' });
    } finally {
      adapted.terminate();
    }
  });
});
