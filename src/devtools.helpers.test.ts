import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskContract } from './contract/types';
import { estimateCloneBytes, previewValue, setDevtoolsSink, type EmittedDevtoolsEvent } from './devtools';
import { log, setLogLevel, setLogSink, type LogEntry } from './log';
import { DedicatedWorker } from './pool/dedicatedWorker';
import { WorkerPool } from './pool/workerPool';
import { measureAtoll } from './userTiming';

/** Worker stand-in: records posts, replies on demand. */
class StubWorker {
  static created: StubWorker[] = [];
  sent: any[] = [];
  private listeners = new Set<(event: { data: any }) => void>();
  constructor() { StubWorker.created.push(this); }
  postMessage(data: any) { this.sent.push(data); }
  addEventListener(t: string, l: (event: { data: any }) => void) { if (t === 'message') this.listeners.add(l); }
  removeEventListener(_t: string, l: (event: { data: any }) => void) { this.listeners.delete(l); }
  terminate() {}
  get tasks() { return this.sent.filter((m) => m.type === 'EXECUTE_TASK'); }
  reply(messageId: number, data: Record<string, unknown>) {
    for (const l of this.listeners) l({ data: { messageId, ...data } });
  }
}

const contract = (taskId: string): TaskContract<any[], any> => ({ taskId });
const collect = () => {
  const events: EmittedDevtoolsEvent[] = [];
  setDevtoolsSink((e) => events.push(e));
  return events;
};

afterEach(() => {
  StubWorker.created = [];
  setDevtoolsSink(null);
  setLogSink(null);
  setLogLevel('info');
  vi.restoreAllMocks();
});

describe('estimateCloneBytes', () => {
  it('sizes primitives, strings, and binary payloads', () => {
    expect(estimateCloneBytes(1)).toBe(8);
    expect(estimateCloneBytes(true)).toBe(4);
    expect(estimateCloneBytes(null)).toBe(1);
    expect(estimateCloneBytes('abcd')).toBe(4 + 8);
    expect(estimateCloneBytes(new Float64Array(16))).toBe(128);
    expect(estimateCloneBytes(new ArrayBuffer(1000))).toBe(1000);
  });

  it('walks objects, arrays, maps and sets with key overhead', () => {
    expect(estimateCloneBytes([1, 2])).toBe(8 + 16);
    expect(estimateCloneBytes({ a: 1 })).toBe(8 + 4 + 2 + 8);
    expect(estimateCloneBytes(new Map([['k', 1]]))).toBe(8 + (4 + 2) + 8);
    expect(estimateCloneBytes(new Set([1, 2]))).toBe(8 + 16);
  });

  it('survives cycles and stops at the node budget', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(Number.isFinite(estimateCloneBytes(o))).toBe(true);
    const big = Array.from({ length: 10_000 }, () => 1);
    expect(estimateCloneBytes(big, 100)).toBeLessThan(estimateCloneBytes(big));
  });
});

describe('previewValue', () => {
  it('renders functions, bigints, binaries and cycles compactly', () => {
    const o: Record<string, unknown> = { fn: () => 1, n: 2n, buf: new Uint8Array(4) };
    o.me = o;
    const p = previewValue(o);
    expect(p).toContain('"[fn]"');
    expect(p).toContain('"2n"');
    expect(p).toContain('[Uint8Array 4B]');
    expect(p).toContain('[cycle]');
  });

  it('caps long output', () => {
    const p = previewValue('x'.repeat(100), 10);
    expect(p).toHaveLength(11);
    expect(p.endsWith('…')).toBe(true);
  });
});

describe('log tee', () => {
  it('mirrors entries as log events and still calls the installed log sink', () => {
    const entries: LogEntry[] = [];
    setLogSink((e) => entries.push(e));
    const events = collect();
    log('warn', 'unit', 'hello', { a: 1 });
    expect(entries).toHaveLength(1);
    expect(events).toEqual([
      expect.objectContaining({ type: 'log', level: 'warn', scope: 'unit', message: 'hello', data: '{"a":1}' }),
    ]);
  });

  it('omits data when absent and respects the log level', () => {
    setLogSink(() => {});
    const events = collect();
    log('debug', 'unit', 'filtered');
    log('info', 'unit', 'kept');
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty('data');
  });

  it('does nothing extra without a devtools sink', () => {
    const entries: LogEntry[] = [];
    setLogSink((e) => entries.push(e));
    log('info', 'unit', 'plain');
    expect(entries).toHaveLength(1);
  });

  it('keeps default console output when no log sink is installed', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    collect();
    log('info', 'unit', 'to console');
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('does not recurse when the devtools sink itself logs', () => {
    setLogSink(() => {});
    const events: EmittedDevtoolsEvent[] = [];
    setDevtoolsSink((e) => {
      events.push(e);
      log('info', 'transport', 'flushing'); // a transport logging from inside the sink
    });
    log('info', 'unit', 'once');
    expect(events.map((e) => (e as { message?: string }).message)).toEqual(['once']);
  });
});

describe('message cost on task events', () => {
  it('DedicatedWorker stamps argBytes on dispatch and resultBytes on settle', async () => {
    const events = collect();
    const dw = new DedicatedWorker({ createWorker: () => new StubWorker() as unknown as Worker });
    const w = StubWorker.created[0];
    const p = dw.runTask(contract('t'), 'abcd', 1);
    w.reply(w.tasks[0].messageId, { success: true, result: new Uint8Array(64) });
    await p;
    expect(events.find((e) => e.type === 'task:dispatch')).toMatchObject({ argBytes: estimateCloneBytes(['abcd', 1]) });
    expect(events.find((e) => e.type === 'task:settle')).toMatchObject({ outcome: 'ok', resultBytes: 64 });
    dw.terminate();
  });

  it('WorkerPool stamps argBytes on dispatch and resultBytes on settle', async () => {
    const events = collect();
    const pool = new WorkerPool({ poolSize: 1, createWorker: () => new StubWorker() as unknown as Worker });
    const w = StubWorker.created[0];
    const p = pool.runTask(contract('t'), { q: 'x' });
    w.reply(w.tasks[0].messageId, { success: true, result: [1, 2, 3] });
    await p;
    expect(events.find((e) => e.type === 'task:dispatch')).toMatchObject({ argBytes: estimateCloneBytes([{ q: 'x' }]) });
    expect(events.find((e) => e.type === 'task:settle')).toMatchObject({ resultBytes: estimateCloneBytes([1, 2, 3]) });
    pool.terminate();
  });

  it('failed calls carry no resultBytes', async () => {
    const events = collect();
    const dw = new DedicatedWorker({ createWorker: () => new StubWorker() as unknown as Worker });
    const w = StubWorker.created[0];
    const p = dw.runTask(contract('bad'));
    w.reply(w.tasks[0].messageId, { success: false, error: 'nope' });
    await expect(p).rejects.toThrow('nope');
    expect(events.find((e) => e.type === 'task:settle')).not.toHaveProperty('resultBytes');
    dw.terminate();
  });
});

describe('User Timing', () => {
  it('measures each settled call on the runner track with Chrome track-entry detail', async () => {
    collect();
    const measure = vi.spyOn(performance, 'measure');
    const dw = new DedicatedWorker({ name: 'timing', createWorker: () => new StubWorker() as unknown as Worker });
    const w = StubWorker.created[0];
    const p = dw.runTask(contract('crunch'));
    w.reply(w.tasks[0].messageId, { success: true, result: 1 });
    await p;
    const call = measure.mock.calls.find(([name]) => name === 'atoll task crunch');
    expect(call).toBeDefined();
    const opts = call![1] as { start: number; end: number; detail: any };
    expect(opts.end).toBeGreaterThanOrEqual(opts.start);
    expect(opts.detail.devtools).toMatchObject({ dataType: 'track-entry', track: dw.poolId, trackGroup: 'atoll', color: 'primary' });
    expect(performance.getEntriesByName('atoll task crunch')).toHaveLength(0); // cleared after capture
    dw.terminate();
  });

  it('records nothing while devtools is off', async () => {
    const measure = vi.spyOn(performance, 'measure');
    const dw = new DedicatedWorker({ createWorker: () => new StubWorker() as unknown as Worker });
    const w = StubWorker.created[0];
    const p = dw.runTask(contract('quiet'));
    w.reply(w.tasks[0].messageId, { success: true, result: 1 });
    await p;
    expect(measure).not.toHaveBeenCalled();
    dw.terminate();
  });

  it('tolerates engines without performance.measure or the options signature', () => {
    vi.spyOn(performance, 'measure').mockImplementation(() => { throw new TypeError('old signature'); });
    expect(() => measureAtoll('x', 0, 1, { track: 't' })).not.toThrow();
    vi.stubGlobal('performance', {});
    expect(() => measureAtoll('x', 0, 1, { track: 't' })).not.toThrow();
    vi.unstubAllGlobals();
  });
});
