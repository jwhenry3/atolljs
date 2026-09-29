// @vitest-environment node
/**
 * Scheduling/dispatch tests — message-only pools over InProcessWorker, so
 * handlers are same-instance deferreds we resolve on cue.
 */
import { describe, expect, it, vi } from 'vitest';
import { WorkerPool } from './workerPool';
import {
  PoolQueueFullError,
  TaskAbortedError,
  TaskTimeoutError,
  WorkerCrashedError,
} from './errors';
import { TaskRegistry } from '../worker/registry';
import { workerClient } from './workerClient';
import { defineWorker } from '../worker/defineWorker';
import { InProcessWorker } from '@atolljs/core/sdk/testing/inProcessWorker';
import type { TaskContract } from '../contract/types';

vi.stubGlobal('Worker', InProcessWorker);

const HOLD: TaskContract<[], string> = { taskId: 'hold' };
const ECHO: TaskContract<[x: unknown], unknown> = { taskId: 'echo' };

/** Release valves for the 'hold' task — each call parks until resolved. */
const releasers: Array<() => void> = [];
TaskRegistry.register(HOLD, () => new Promise((r) => releasers.push(() => r('held'))));
TaskRegistry.register(ECHO, (x: unknown) => x);

const spawnWorker = () => new Worker(new URL('./x.ts', import.meta.url)) as unknown as Worker;

const pool = (extra: Record<string, unknown> = {}) =>
  new WorkerPool({ createWorker: spawnWorker, ...extra } as never);

const flush = () => new Promise((r) => setTimeout(r, 5));
/** Waits until N EXECUTE_TASKs have been handed to workers. */
const untilExecuted = async (n: number) =>
  vi.waitFor(() =>
    expect(InProcessWorker.created.reduce((a, w) => a + w.executed.length, 0)).toBe(n),
  );

describe('workerPool scheduling', () => {
  it('concurrency=1 queues the third task, drains on completion', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 2 });
    const t1 = p.runTask(HOLD);
    const t2 = p.runTask(HOLD);
    const t3 = p.runTask(HOLD);
    await untilExecuted(2);
    expect(p.stats().queued).toBe(1);
    expect(p.stats().inFlight).toBe(2);

    releasers.shift()!(); // free worker 0 — queued task drains
    await vi.waitFor(() =>
      expect(InProcessWorker.created.reduce((a, w) => a + w.executed.length, 0)).toBe(3),
    );
    while (releasers.length) releasers.shift()!();
    await Promise.all([t1, t2, t3]);
    expect(p.stats().queued).toBe(0);
    p.terminate();
  });

  it('schedules least-busy: concurrency=2 splits 3 tasks [2,1]', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 2, concurrency: 2 });
    const tasks = [p.runTask(HOLD), p.runTask(HOLD), p.runTask(HOLD)];
    await untilExecuted(3);
    const counts = InProcessWorker.created.map((w) => w.executed.length).sort();
    expect(counts).toEqual([1, 2]);
    while (releasers.length) releasers.shift()!();
    await Promise.all(tasks);
    p.terminate();
  });

  it('maxQueue=0 rejects immediately with PoolQueueFullError, failed unchanged', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1, maxQueue: 0 });
    const t = p.runTask(HOLD);
    await untilExecuted(1);
    const failedBefore = p.stats().failed;
    await expect(p.runTask(HOLD)).rejects.toBeInstanceOf(PoolQueueFullError);
    expect(p.stats().failed).toBe(failedBefore);
    while (releasers.length) releasers.shift()!();
    await t;
    p.terminate();
  });

  it('abort while queued: TaskAbortedError, task never reaches a worker', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1 });
    const t = p.runTask(HOLD);
    await untilExecuted(1);
    const ac = new AbortController();
    const queued = p.dispatch(HOLD, [], { signal: ac.signal });
    expect(p.stats().queued).toBe(1);
    ac.abort();
    await expect(queued).rejects.toBeInstanceOf(TaskAbortedError);
    await expect(queued).rejects.toHaveProperty('name', 'AbortError');
    await flush();
    expect(InProcessWorker.created[0].executed).toHaveLength(1);
    while (releasers.length) releasers.shift()!();
    await t;
    p.terminate();
  });

  it('abort in-flight: rejects now, the worker reply is discarded', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1 });
    const ac = new AbortController();
    const t = p.dispatch(HOLD, [], { signal: ac.signal });
    await untilExecuted(1);
    ac.abort();
    await expect(t).rejects.toBeInstanceOf(TaskAbortedError);
    // Orphaned: the worker is still running it, so the slot stays occupied.
    expect(p.stats().inFlight).toBe(1);
    // Worker finishes anyway — the reply frees the slot, no unhandled rejection.
    while (releasers.length) releasers.shift()!();
    await vi.waitFor(() => expect(p.stats().inFlight).toBe(0));
    p.terminate();
  });

  it('aborted in-flight task keeps its slot until the worker replies (orphan)', async () => {
    InProcessWorker.created = [];
    releasers.length = 0;
    const p = pool({ poolSize: 1 });
    const ac = new AbortController();
    const a = p.dispatch(HOLD, [], { signal: ac.signal });
    await untilExecuted(1);
    ac.abort();
    await expect(a).rejects.toBeInstanceOf(TaskAbortedError);

    // The worker is still running A — the slot stays occupied, B must queue.
    const b = p.runTask(HOLD);
    await flush();
    expect(p.stats().queued).toBe(1);
    expect(InProcessWorker.created[0].executed).toHaveLength(1);
    expect(p.stats().inFlight).toBe(1);

    // A's reply arrives → slot frees → B runs.
    releasers.shift()!();
    await vi.waitFor(() => expect(InProcessWorker.created[0].executed).toHaveLength(2));
    releasers.shift()!();
    await b;
    const s = p.stats();
    expect(s.inFlight).toBe(0);
    expect(s.aborted).toBe(1);
    expect(s.completed).toBe(1);
    p.terminate();
  });

  it('crash after terminate() is ignored — no resurrected workers', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1 });
    await p.runTask(ECHO, 1);
    p.terminate();
    InProcessWorker.created[0].crash('late');
    await flush();
    expect(InProcessWorker.created).toHaveLength(1);
    expect(p.stats().workers).toBe(0);
  });

  it('crash does not double-count an already-aborted in-flight task', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1 });
    const ac = new AbortController();
    const a = p.dispatch(HOLD, [], { signal: ac.signal });
    await untilExecuted(1);
    ac.abort();
    await expect(a).rejects.toBeInstanceOf(TaskAbortedError);
    InProcessWorker.created[0].crash('boom');
    const s = p.stats();
    expect(s.failed).toBe(0);
    expect(s.aborted).toBe(1);
    releasers.length = 0;
  });

  it('taskTimeout config and per-call timeout both reject TaskTimeoutError', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1, taskTimeout: 5 });
    await expect(p.runTask(HOLD)).rejects.toBeInstanceOf(TaskTimeoutError);
    // The timed-out task stays orphaned until its reply — free the slot.
    while (releasers.length) releasers.shift()!();
    await vi.waitFor(() => expect(p.stats().inFlight).toBe(0));

    // Per-call timeout fires while the task waits in the queue.
    const hold = p.dispatch(HOLD, [], { timeout: 1000 });
    const timedOut = p.dispatch(ECHO, ['x'], { timeout: 1 });
    await expect(timedOut).rejects.toBeInstanceOf(TaskTimeoutError);
    while (releasers.length) releasers.shift()!();
    await hold;
    p.terminate();
  });

  it('crash: in-flight rejects WorkerCrashedError, worker respawns, next task succeeds', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1 });
    const t = p.runTask(HOLD);
    await untilExecuted(1);
    InProcessWorker.created[0].crash('boom');
    await expect(t).rejects.toBeInstanceOf(WorkerCrashedError);
    expect(InProcessWorker.created).toHaveLength(2); // respawned
    await expect(p.runTask(ECHO, 'alive')).resolves.toBe('alive');
    p.terminate();
  });

  it('respawn:false shrinks the pool; last worker crash rejects the queue', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1, respawn: false });
    const t = p.runTask(HOLD);
    const queued = p.runTask(HOLD);
    await untilExecuted(1);
    InProcessWorker.created[0].crash('dead');
    await expect(t).rejects.toBeInstanceOf(WorkerCrashedError);
    await expect(queued).rejects.toBeInstanceOf(WorkerCrashedError);
    expect(p.stats().workers).toBe(0);
  });

  it('stats track completed/failed/aborted plus waitMs/runMs counts', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1 });
    await p.runTask(ECHO, 1);
    await expect(p.runTask({ taskId: 'missing-task' })).rejects.toThrow(/not found/i);
    const s = p.stats();
    expect(s.completed).toBeGreaterThanOrEqual(1);
    expect(s.failed).toBeGreaterThanOrEqual(1);
    expect(s.waitMs.count).toBeGreaterThan(0);
    expect(s.runMs.count).toBeGreaterThan(0);
    p.terminate();
  });

  it('close() waits for in-flight work, then runTask rejects', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1 });
    const t = p.runTask(HOLD);
    await untilExecuted(1);
    let closed = false;
    const c = p.close().then(() => (closed = true));
    await flush();
    expect(closed).toBe(false);
    while (releasers.length) releasers.shift()!();
    await t;
    await c;
    expect(closed).toBe(true);
    await expect(p.runTask(ECHO, [])).rejects.toBeInstanceOf(WorkerCrashedError);
  });

  it('terminate() rejects queued and in-flight tasks with WorkerCrashedError', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1 });
    const t1 = p.runTask(HOLD);
    const t2 = p.runTask(HOLD);
    await untilExecuted(1);
    p.terminate();
    await expect(t1).rejects.toBeInstanceOf(WorkerCrashedError);
    await expect(t2).rejects.toBeInstanceOf(WorkerCrashedError);
    releasers.length = 0;
  });

  it('client.with({ timeout }) dispatches with options', async () => {
    InProcessWorker.created = [];
    const p = pool({ poolSize: 1 });
    let releaseHold: (() => void) | undefined;
    const w = defineWorker({
      methods: {
        stall: () => new Promise<string>((r) => (releaseHold = () => r('done'))),
        pick: (x: number) => x,
      },
    });
    const client = workerClient<typeof w>(p);
    await expect(client.with({ timeout: 5 }).stall()).rejects.toBeInstanceOf(TaskTimeoutError);
    // The timed-out call orphans until the worker replies — free the slot.
    releaseHold!();
    await vi.waitFor(() => expect(p.stats().inFlight).toBe(0));
    await expect(client.with({ timeout: 1000 }).pick(3)).resolves.toBe(3);
    p.terminate();
  });

  it("'with' is a reserved worker method name — compile error and runtime throw", () => {
    // @ts-expect-error reserved client keys are rejected by NoReserved
    expect(() => defineWorker({ methods: { with: () => 1 } })).toThrow(/reserved/i);
  });
});
