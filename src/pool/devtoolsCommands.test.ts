import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskContract } from '../contract/types';
import { listDevtoolsCommands, runDevtoolsCommand, setDevtoolsSink, type DevtoolsEvent } from '../devtools';
import { DedicatedWorker } from './dedicatedWorker';
import { CHAOS_FAILURE, KILL_MESSAGE, parseChaos } from './devtoolsCommands';
import { TaskTimeoutError, WorkerCrashedError } from './errors';
import { WorkerPool } from './workerPool';

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
  reply(messageId: number, result: unknown) {
    for (const l of this.listeners.get('message') ?? []) l({ data: { messageId, success: true, result } });
  }
}

const contract = (taskId: string): TaskContract<any[], any> => ({ taskId });
const createWorker = () => new HeldWorker() as unknown as Worker;

describe('pool devtools commands', () => {
  let events: DevtoolsEvent[];
  beforeEach(() => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
  });
  afterEach(() => {
    HeldWorker.created = [];
    setDevtoolsSink(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers nothing while devtools is off', () => {
    setDevtoolsSink(null);
    const pool = new WorkerPool({ createWorker, poolSize: 1 });
    expect(listDevtoolsCommands()).not.toContain('pool.list');
    pool.terminate();
  });

  it('lists live runners and their stats, and cleans up on terminate/close', async () => {
    const pool = new WorkerPool({ createWorker, poolSize: 2, name: 'cmds' });
    const solo = new DedicatedWorker({ createWorker });
    expect(listDevtoolsCommands()).toEqual(expect.arrayContaining(['pool.list', 'pool.stats', 'worker.kill', 'pool.chaos']));

    const list = (await runDevtoolsCommand('pool.list')) as any[];
    expect(list).toEqual(expect.arrayContaining([
      { poolId: pool.poolId, label: 'cmds', size: 2, dedicated: false, chaos: null },
      { poolId: solo.poolId, label: solo.poolId, size: 1, dedicated: true, chaos: null },
    ]));
    expect(await runDevtoolsCommand('pool.stats', { poolId: pool.poolId })).toMatchObject({ workers: 2, idle: 2 });
    await expect(runDevtoolsCommand('pool.stats', { poolId: 'nope' })).rejects.toThrow(/no live runner/);
    await expect(runDevtoolsCommand('pool.stats', { poolId: 'pool-1#0~pool-1' })).rejects.toThrow(/inside a worker/);

    pool.terminate();
    const after = (await runDevtoolsCommand('pool.list')) as any[];
    expect(after.map((r) => r.poolId)).toEqual([solo.poolId]);
    await solo.close();
    // last runner gone: the pool commands are no longer advertised
    expect(listDevtoolsCommands()).not.toContain('pool.list');
  });

  it('worker.kill runs the pool crash path: rejects in-flight, emits error + respawn', async () => {
    const pool = new WorkerPool({ createWorker, poolSize: 2 });
    const [w0, w1] = HeldWorker.created;
    const p = pool.runTask(contract('doomed'));
    expect(w0.tasks).toHaveLength(1);

    await expect(runDevtoolsCommand('worker.kill', { poolId: pool.poolId, slot: 0 })).resolves.toMatchObject({ killed: true });
    await expect(p).rejects.toBeInstanceOf(WorkerCrashedError);
    await expect(p).rejects.toThrow(KILL_MESSAGE);
    expect(w0.terminated).toBe(true);
    expect(HeldWorker.created).toHaveLength(3);
    expect(pool.workers).toEqual([w1, HeldWorker.created[2]]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'worker:error', poolId: pool.poolId, slot: 0, message: KILL_MESSAGE }),
      expect.objectContaining({ type: 'task:settle', outcome: 'crashed' }),
      expect.objectContaining({ type: 'worker:respawn', poolId: pool.poolId }),
    ]));
    await expect(runDevtoolsCommand('worker.kill', { poolId: pool.poolId, slot: 9 })).rejects.toThrow(/no worker slot 9/);
    pool.terminate();
  });

  it('worker.kill on a dedicated worker crashes and respawns it', async () => {
    const dw = new DedicatedWorker({ createWorker });
    const p = dw.runTask(contract('doomed'));
    await runDevtoolsCommand('worker.kill', { poolId: dw.poolId });
    await expect(p).rejects.toBeInstanceOf(WorkerCrashedError);
    expect(HeldWorker.created).toHaveLength(2);
    expect(events.some((e) => e.type === 'worker:respawn' && e.poolId === dw.poolId)).toBe(true);
    dw.terminate();
  });

  it('pool.chaos delays dispatch, then clears with poolId alone', async () => {
    vi.useFakeTimers();
    const pool = new WorkerPool({ createWorker, poolSize: 1 });
    const w = HeldWorker.created[0];
    expect(await runDevtoolsCommand('pool.chaos', { poolId: pool.poolId, delayMs: 100 })).toEqual({ delayMs: 100 });
    expect(((await runDevtoolsCommand('pool.list')) as any[])[0].chaos).toEqual({ delayMs: 100 });

    const p = pool.runTask(contract('slow'));
    expect(w.tasks).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(w.tasks).toHaveLength(1);
    w.reply(w.tasks[0].messageId, 'ok');
    await expect(p).resolves.toBe('ok');

    expect(await runDevtoolsCommand('pool.chaos', { poolId: pool.poolId })).toBeNull();
    const q = pool.runTask(contract('fast'));
    expect(w.tasks).toHaveLength(2);
    w.reply(w.tasks[1].messageId, 'ok');
    await expect(q).resolves.toBe('ok');
    pool.terminate();
  });

  it('pool.chaos failRate rejects without reaching the worker (outcome error)', async () => {
    vi.useFakeTimers();
    const pool = new WorkerPool({ createWorker, poolSize: 1 });
    const w = HeldWorker.created[0];
    await runDevtoolsCommand('pool.chaos', { poolId: pool.poolId, failRate: 1 });
    const p = pool.runTask(contract('t'));
    const caught = p.catch((e: Error) => e);
    vi.advanceTimersByTime(0);
    expect((await caught).message).toBe(CHAOS_FAILURE);
    expect(w.tasks).toHaveLength(0);
    expect(pool.stats()).toMatchObject({ failed: 1, inFlight: 0, idle: 1 });
    expect(events.find((e) => e.type === 'task:settle')).toMatchObject({ outcome: 'error', error: CHAOS_FAILURE });
    pool.terminate();
  });

  it('pool.chaos timeoutRate settles through the timeout path and still runs the call', async () => {
    vi.useFakeTimers();
    const dw = new DedicatedWorker({ createWorker });
    const w = HeldWorker.created[0];
    await runDevtoolsCommand('pool.chaos', { poolId: dw.poolId, timeoutRate: 1 });
    const p = dw.runTask(contract('t'));
    const caught = p.catch((e: unknown) => e);
    vi.advanceTimersByTime(0);
    expect(await caught).toBeInstanceOf(TaskTimeoutError);
    expect(w.tasks).toHaveLength(1);
    expect(events.find((e) => e.type === 'task:settle')).toMatchObject({ outcome: 'timeout' });
    w.reply(w.tasks[0].messageId, 'late');
    expect(dw.stats()).toMatchObject({ aborted: 1, inFlight: 0 });
    dw.terminate();
  });

  it('pool.chaos rolls per call against Math.random', async () => {
    vi.useFakeTimers();
    const pool = new WorkerPool({ createWorker, poolSize: 1, concurrency: 4 });
    const w = HeldWorker.created[0];
    await runDevtoolsCommand('pool.chaos', { poolId: pool.poolId, failRate: 0.5 });
    const rnd = vi.spyOn(Math, 'random');
    rnd.mockReturnValueOnce(0.9);
    const ok = pool.runTask(contract('pass'));
    expect(w.tasks).toHaveLength(1); // no delay, no roll: posted synchronously
    rnd.mockReturnValueOnce(0.1);
    const bad = pool.runTask(contract('fail')).catch((e: Error) => e.message);
    vi.advanceTimersByTime(0);
    expect(await bad).toBe(CHAOS_FAILURE);
    w.reply(w.tasks[0].messageId, 'ok');
    await expect(ok).resolves.toBe('ok');
    pool.terminate();
  });

  it('a call crashed during the chaos delay is not posted to the dead worker', async () => {
    vi.useFakeTimers();
    const pool = new WorkerPool({ createWorker, poolSize: 1 });
    const w = HeldWorker.created[0];
    await runDevtoolsCommand('pool.chaos', { poolId: pool.poolId, delayMs: 50 });
    const p = pool.runTask(contract('t')).catch((e: unknown) => e);
    await runDevtoolsCommand('worker.kill', { poolId: pool.poolId, slot: 0 });
    expect(await p).toBeInstanceOf(WorkerCrashedError);
    vi.advanceTimersByTime(50);
    expect(w.tasks).toHaveLength(0);
    pool.terminate();
  });

  it('validates chaos args', () => {
    expect(parseChaos({})).toBeNull();
    expect(parseChaos({ delayMs: 0, failRate: 0 })).toBeNull();
    expect(parseChaos({ delayMs: 5, failRate: 0.2, timeoutRate: 0.1 })).toEqual({ delayMs: 5, failRate: 0.2, timeoutRate: 0.1 });
    expect(() => parseChaos({ failRate: 2 })).toThrow(/0\.\.1/);
    expect(() => parseChaos({ delayMs: -1 })).toThrow(/non-negative/);
    expect(() => parseChaos({ failRate: 0.7, timeoutRate: 0.5 })).toThrow(/exceed 1/);
  });
});
