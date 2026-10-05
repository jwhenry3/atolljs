import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineSharedMemory, field } from '../contract/sharedMemory';
import type { TaskContract } from '../contract/types';
import { setDevtoolsSink, type DevtoolsEvent } from '../devtools';
import { DedicatedWorker } from './dedicatedWorker';
import { TaskAbortedError, TaskTimeoutError, WorkerCrashedError } from './errors';

/** Worker stand-in that holds replies until the test releases them. */
class HeldWorker {
  static created: HeldWorker[] = [];
  public sent: any[] = [];
  public terminated = false;
  private listeners = new Map<string, Set<(event: any) => void>>();

  constructor() {
    HeldWorker.created.push(this);
  }

  postMessage(data: any) { this.sent.push(data); }
  addEventListener(t: string, l: (event: any) => void) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(l);
  }
  removeEventListener(t: string, l: (event: any) => void) { this.listeners.get(t)?.delete(l); }
  terminate() { this.terminated = true; }

  get tasks() { return this.sent.filter((m) => m.type === 'EXECUTE_TASK'); }
  reply(messageId: number, result: unknown, success = true) {
    const data = success ? { messageId, success, result } : { messageId, success, error: String(result) };
    for (const l of this.listeners.get('message') ?? []) l({ data });
  }
  crash(message = 'boom') {
    for (const l of this.listeners.get('error') ?? []) l({ message });
  }
}

const contract = (taskId: string): TaskContract<any[], any> => ({ taskId });

const make = (extra: Record<string, unknown> = {}) =>
  new DedicatedWorker({ createWorker: () => new HeldWorker() as unknown as Worker, ...extra });

describe('DedicatedWorker', () => {
  afterEach(() => {
    HeldWorker.created = [];
    setDevtoolsSink(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('spawns one worker and posts every call immediately, without queueing', async () => {
    const dw = make();
    expect(HeldWorker.created).toHaveLength(1);
    const w = HeldWorker.created[0];
    expect(w.sent[0].type).toBe('INIT');

    const a = dw.runTask(contract('a'), 1);
    const b = dw.runTask(contract('b'), 2);
    expect(w.tasks.map((m) => [m.taskId, m.args])).toEqual([['a', [1]], ['b', [2]]]);
    expect(dw.stats()).toMatchObject({ workers: 1, inFlight: 2, queued: 0, idle: 0 });

    w.reply(w.tasks[1].messageId, 'B');
    w.reply(w.tasks[0].messageId, 'A');
    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
    expect(dw.stats()).toMatchObject({ inFlight: 0, idle: 1, completed: 2, waitMs: { count: 0 } });
    dw.terminate();
  });

  it('sends INIT_MEMORY when given a shared memory spec', () => {
    make({ sharedMemory: defineSharedMemory({ n: field.number() }) });
    const init = HeldWorker.created[0].sent[0];
    expect(init.type).toBe('INIT_MEMORY');
    expect(init.memory).toBeInstanceOf(WebAssembly.Memory);
  });

  it('rejects with the worker error message on a failed task', async () => {
    const dw = make();
    const w = HeldWorker.created[0];
    const p = dw.runTask(contract('bad'));
    w.reply(w.tasks[0].messageId, 'unknown app', false);
    await expect(p).rejects.toThrow(/unknown app/);
    expect(dw.stats().failed).toBe(1);
    dw.terminate();
  });

  it('times out a call and discards the late reply', async () => {
    vi.useFakeTimers();
    const dw = make({ taskTimeout: 50 });
    const w = HeldWorker.created[0];
    const p = dw.runTask(contract('slow'));
    vi.advanceTimersByTime(51);
    await expect(p).rejects.toBeInstanceOf(TaskTimeoutError);
    w.reply(w.tasks[0].messageId, 'late');
    expect(dw.stats()).toMatchObject({ aborted: 1, completed: 0, inFlight: 0 });
    dw.terminate();
  });

  it('aborts via AbortSignal, before and during flight', async () => {
    const dw = make();
    const pre = new AbortController();
    pre.abort();
    await expect(dw.dispatch(contract('x'), [], { signal: pre.signal })).rejects.toBeInstanceOf(TaskAbortedError);
    expect(HeldWorker.created[0].tasks).toHaveLength(0);

    const mid = new AbortController();
    const p = dw.dispatch(contract('y'), [], { signal: mid.signal });
    mid.abort();
    await expect(p).rejects.toBeInstanceOf(TaskAbortedError);
    dw.terminate();
  });

  it('rejects in-flight calls on crash and respawns a fresh worker', async () => {
    const dw = make();
    const first = HeldWorker.created[0];
    const p = dw.runTask(contract('doomed'));
    first.crash('kaboom');
    await expect(p).rejects.toBeInstanceOf(WorkerCrashedError);
    expect(first.terminated).toBe(true);
    expect(HeldWorker.created).toHaveLength(2);

    const second = HeldWorker.created[1];
    const q = dw.runTask(contract('next'));
    second.reply(second.tasks[0].messageId, 'ok');
    await expect(q).resolves.toBe('ok');
    dw.terminate();
  });

  it('stays down after a crash with respawn: false', async () => {
    const dw = make({ respawn: false });
    HeldWorker.created[0].crash();
    expect(HeldWorker.created).toHaveLength(1);
    await expect(dw.runTask(contract('x'))).rejects.toBeInstanceOf(WorkerCrashedError);
    dw.terminate();
  });

  it('emits pool:init flagged dedicated, with slot-0 task events', async () => {
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((e) => events.push(e));
    const dw = make({ name: 'solo' });
    const w = HeldWorker.created[0];
    const p = dw.runTask(contract('t'));
    w.reply(w.tasks[0].messageId, 1);
    await p;

    const init = events.find((e) => e.type === 'pool:init');
    expect(init).toMatchObject({ poolId: dw.poolId, label: 'solo', poolSize: 1, concurrency: 0, dedicated: true });
    expect(dw.poolId).toMatch(/^solo-w\d*$/);
    expect(make().poolId).toMatch(/^worker-\d+$/);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['worker:spawn', 'task:enqueue', 'task:dispatch', 'task:settle']),
    );
    expect(events.find((e) => e.type === 'task:dispatch')).toMatchObject({ slot: 0, waitMs: 0 });
    dw.terminate();
  });

  it('close() waits for in-flight calls, then terminates', async () => {
    const dw = make();
    const w = HeldWorker.created[0];
    const p = dw.runTask(contract('t'));
    let closed = false;
    const c = dw.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    w.reply(w.tasks[0].messageId, 'done');
    await expect(p).resolves.toBe('done');
    await c;
    expect(w.terminated).toBe(true);
    await expect(dw.runTask(contract('late'))).rejects.toThrow(/terminated/);
  });

  it('terminate() rejects in-flight calls', async () => {
    const dw = make();
    const p = dw.runTask(contract('t'));
    dw.terminate();
    await expect(p).rejects.toThrow(/worker terminated/);
    expect(dw.workers).toHaveLength(0);
  });

  it('throws when neither workerUrl nor createWorker is provided', () => {
    expect(() => new DedicatedWorker({})).toThrow(/workerUrl.*createWorker/);
  });
});
