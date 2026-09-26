import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineSharedMemory, field } from '../contract/sharedMemory';
import type { TaskContract } from '../contract/types';
import { setLogSink } from '../log';
import { WorkerPool } from './workerPool';

/** Minimal Worker stand-in: echoes the taskId back as the result so tests can
 *  verify which contract a dispatch carried. */
class EchoWorker {
  static created: EchoWorker[] = [];

  public sent: any[] = [];
  public terminated = false;
  private listeners = new Set<(event: { data: any }) => void>();

  constructor(public url: URL, public options: any) {
    EchoWorker.created.push(this);
  }

  postMessage(data: any) {
    this.sent.push(data);
    if (data.type === 'EXECUTE_TASK') {
      queueMicrotask(() => {
        for (const l of this.listeners) l({ data: { messageId: data.messageId, success: true, result: data.taskId } });
      });
    }
  }

  addEventListener(_t: string, l: (event: { data: any }) => void) { this.listeners.add(l); }
  removeEventListener(_t: string, l: (event: { data: any }) => void) { this.listeners.delete(l); }
  terminate() { this.terminated = true; }
}

const mem = () => defineSharedMemory({ n: field.number() });
const contract = (taskId: string): TaskContract<[], string> => ({ taskId });

describe('WorkerPool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    EchoWorker.created = [];
    setLogSink(null);
  });

  const makePool = (extra: Record<string, unknown> = {}) =>
    new WorkerPool({
      workerUrl: new URL('https://example.test/w.ts'),
      sharedMemory: mem(),
      poolSize: 2,
      ...extra,
    });

  it('hands each spawned worker the shared memory via INIT_MEMORY', () => {
    vi.stubGlobal('Worker', EchoWorker);
    makePool();
    expect(EchoWorker.created).toHaveLength(2);
    for (const w of EchoWorker.created) {
      expect(w.sent[0].type).toBe('INIT_MEMORY');
      expect(w.sent[0].memory).toBeInstanceOf(WebAssembly.Memory);
      expect(w.options).toEqual({ type: 'module' });
    }
  });

  it('installs first-class task methods that dispatch their contract', async () => {
    vi.stubGlobal('Worker', EchoWorker);
    const pool = makePool({ tasks: { ping: contract('t-ping'), pong: contract('t-pong') } });
    // EchoWorker replies with the dispatched taskId — proves each method
    // carries its own contract
    await expect(pool.ping()).resolves.toBe('t-ping');
    await expect(pool.pong()).resolves.toBe('t-pong');
    pool.terminate();
  });

  it('warns and skips a task method that collides with a WorkerPool member', async () => {
    vi.stubGlobal('Worker', EchoWorker);
    const warnings: string[] = [];
    setLogSink((e) => { if (e.level === 'warn') warnings.push(e.message); });
    const pool = makePool({ tasks: { runTask: contract('t-evil'), ok: contract('t-ok') } });
    expect(warnings.join(' ')).toMatch(/collides/);
    // the real runTask survived — and the non-colliding task still installed
    await expect(pool.runTask(contract('t-direct'))).resolves.toBe('t-direct');
    await expect(pool.ok()).resolves.toBe('t-ok');
    pool.terminate();
  });

  it('rejects runTask after terminate', async () => {
    vi.stubGlobal('Worker', EchoWorker);
    const pool = makePool();
    pool.terminate();
    await expect(pool.runTask(contract('t-late'))).rejects.toThrow(/terminated/);
  });

  it('works without a tasks map', async () => {
    vi.stubGlobal('Worker', EchoWorker);
    const pool = makePool();
    await expect(pool.runTask(contract('t-plain'))).resolves.toBe('t-plain');
    pool.terminate();
  });
});
