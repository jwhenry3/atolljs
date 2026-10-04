import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineSharedMemory, field } from './contract/sharedMemory';
import type { TaskContract } from './contract/types';
import { setDevtoolsSink, type DevtoolsEvent, type EmittedDevtoolsEvent } from './devtools';
import { WorkerPool } from './pool/workerPool';

/** Same stub shape as workerPool.test.ts — echoes taskId back as the result. */
class EchoWorker {
  public sent: any[] = [];
  private listeners = new Set<(event: { data: any }) => void>();

  constructor(public url: URL, public options: any) {}

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
  terminate() {}
}

const mem = () => defineSharedMemory({ n: field.number() });
const contract = (taskId: string): TaskContract<[], string> => ({ taskId });

describe('devtools events', () => {
  let events: EmittedDevtoolsEvent[];
  const types = () => events.map((e) => e.type);
  const ofType = <T extends DevtoolsEvent['type']>(t: T) =>
    events.filter((e) => e.type === t) as Extract<EmittedDevtoolsEvent, { type: T }>[];

  afterEach(() => {
    vi.unstubAllGlobals();
    setDevtoolsSink(null);
    events = [];
  });

  const makePool = (extra: Record<string, unknown> = {}) =>
    new WorkerPool({
      workerUrl: new URL('https://example.test/w.ts'),
      sharedMemory: mem(),
      poolSize: 2,
      ...extra,
    });

  it('emits pool:init, memory:bind, and one worker:spawn per slot', () => {
    vi.stubGlobal('Worker', EchoWorker);
    events = [];
    setDevtoolsSink((e) => events.push(e));
    const pool = makePool({ name: 'incidents' });
    const init = ofType('pool:init');
    expect(init).toHaveLength(1);
    expect(init[0]).toMatchObject({ label: 'incidents', poolSize: 2, concurrency: 1 });
    expect(init[0].memoryBytes).toBeGreaterThan(0);
    expect(ofType('worker:spawn')).toHaveLength(2);
    expect(ofType('memory:bind')).toHaveLength(1);
    expect(ofType('memory:bind')[0].fields).toContainEqual([0, 'n']);
    pool.terminate();
  });

  it('correlates a task call across enqueue → dispatch → settle', async () => {
    vi.stubGlobal('Worker', EchoWorker);
    events = [];
    setDevtoolsSink((e) => events.push(e));
    const pool = makePool();
    await expect(pool.runTask(contract('t-ping'))).resolves.toBe('t-ping');
    const enq = ofType('task:enqueue').at(-1)!;
    const disp = ofType('task:dispatch').at(-1)!;
    const set = ofType('task:settle').at(-1)!;
    expect(enq.taskId).toBe('t-ping');
    expect(disp.taskId).toBe('t-ping');
    expect(set).toMatchObject({ taskId: 't-ping', outcome: 'ok' });
    expect(disp.callId).toBe(enq.callId);
    expect(set.callId).toBe(enq.callId);
    expect(disp.waitMs).toBeGreaterThanOrEqual(0);
    expect(set.runMs).toBeGreaterThanOrEqual(0);
    pool.terminate();
  });

  it('settles queue-full when the bounded queue is saturated', async () => {
    vi.stubGlobal('Worker', EchoWorker);
    events = [];
    setDevtoolsSink((e) => events.push(e));
    // Never-reply worker: first call occupies the single slot, second queues,
    // third overflows maxQueue: 1.
    class MuteWorker extends EchoWorker {
      postMessage(data: any) { this.sent.push(data); }
    }
    vi.stubGlobal('Worker', MuteWorker);
    const pool = new WorkerPool({ workerUrl: new URL('https://example.test/w.ts'), poolSize: 1, maxQueue: 1 });
    void pool.runTask(contract('a')).catch(() => {});
    void pool.runTask(contract('b')).catch(() => {});
    await expect(pool.runTask(contract('c'))).rejects.toThrow(/queue/i);
    expect(ofType('task:settle').at(-1)).toMatchObject({ taskId: 'c', outcome: 'queue-full' });
    pool.terminate();
  });

  it('emits memory:write with the bumped version on field writes', () => {
    vi.stubGlobal('Worker', EchoWorker);
    events = [];
    const pool = makePool();
    setDevtoolsSink((e) => events.push(e));
    pool.sharedMemory!.n.write(7);
    pool.sharedMemory!.n.write(8);
    const writes = ofType('memory:write');
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ path: 'n', version: 1 });
    expect(writes[1]).toMatchObject({ path: 'n', version: 2 });
    pool.terminate();
  });

  it('emits pool:terminate and crashed settles for in-flight calls', () => {
    vi.stubGlobal('Worker', EchoWorker);
    events = [];
    setDevtoolsSink((e) => events.push(e));
    class MuteWorker extends EchoWorker {
      postMessage(data: any) { this.sent.push(data); }
    }
    vi.stubGlobal('Worker', MuteWorker);
    const pool = new WorkerPool({ workerUrl: new URL('https://example.test/w.ts'), poolSize: 1 });
    const pending = pool.runTask(contract('a')).catch((e) => e);
    pool.terminate();
    expect(types()).toContain('pool:terminate');
    expect(ofType('task:settle').at(-1)).toMatchObject({ taskId: 'a', outcome: 'crashed' });
    return pending;
  });

  it('is a no-op when no sink is installed', () => {
    vi.stubGlobal('Worker', EchoWorker);
    const pool = makePool();
    pool.terminate();
    // Reaching here without a sink installed is the assertion — emit()
    // must not throw.
  });
});
