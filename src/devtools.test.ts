import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineSharedMemory, field } from './contract/sharedMemory';
import type { TaskContract } from './contract/types';
import {
  devtoolsEnabled,
  emitDevtools,
  enableWorkerDevtoolsForwarding,
  forwardDevtools,
  installFetchProbe,
  installMemoryProbe,
  nextDevtoolsId,
  setDevtoolsSink,
  type DevtoolsEvent,
  type EmittedDevtoolsEvent,
} from './devtools';
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

  it('forwardDevtools re-emits a stamped event without re-stamping', () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    const stamped: EmittedDevtoolsEvent = {
      type: 'memory:write', path: 'n', version: 3,
      at: 42, thread: 'worker', worker: { poolId: 'pool-2', slot: 1 },
    };
    forwardDevtools(stamped);
    expect(events).toHaveLength(1);
    expect(events[0].at).toBe(42);
    expect(events[0].worker).toEqual({ poolId: 'pool-2', slot: 1 });
  });

  it('worker forwarding posts ATOLL_DEVTOOLS messages and stamps nothing twice', () => {
    // A minimal `self` — the shape a worker global has: the forwarding sink
    // posts ATOLL_DEVTOOLS onto it and the fetch/memory probes no-op for
    // lack of fetch/performance.
    const posted: any[] = [];
    vi.stubGlobal('self', { postMessage: (m: any) => posted.push(m) });
    enableWorkerDevtoolsForwarding();
    emitDevtools({ type: 'worker:spawn', poolId: 'pool-1', slot: 0 });
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('ATOLL_DEVTOOLS');
    expect(posted[0].event.type).toBe('worker:spawn');
    expect(posted[0].event.thread).toBe('main'); // stamped at emit time, not by forwarding
  });

  it('nextDevtoolsId yields sequential process-unique ids', () => {
    const a = nextDevtoolsId('pool');
    const b = nextDevtoolsId('pool');
    expect(a).toMatch(/^pool-\d+$/);
    expect(Number(b.slice(5))).toBe(Number(a.slice(5)) + 1);
  });

  it('devtoolsEnabled reflects sink installation', () => {
    setDevtoolsSink(null);
    expect(devtoolsEnabled()).toBe(false);
    setDevtoolsSink(() => {});
    expect(devtoolsEnabled()).toBe(true);
    setDevtoolsSink(null);
  });

  it('memory probe falls back to process.memoryUsage when perf APIs are absent', async () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    // A scope with a performance object but neither memory nor
    // measureUserAgentSpecificMemory — the Node shape.
    installMemoryProbe({ performance: {} }, 20);
    await new Promise((r) => setTimeout(r, 80));
    const m = ofType('runtime:memory').at(-1);
    expect(m?.heapBytes).toBeGreaterThan(0);
    expect(m?.rssBytes).toBeGreaterThan(0);
  });

  it('is a no-op when no sink is installed', () => {
    vi.stubGlobal('Worker', EchoWorker);
    const pool = makePool();
    pool.terminate();
    // Reaching here without a sink installed is the assertion — emit()
    // must not throw.
  });
});

describe('installMemoryProbe', () => {
  let events: EmittedDevtoolsEvent[];
  // Probe intervals are unref'd but never stopped — earlier tests' probes
  // keep emitting. Assertions match a probe's unique values via `some`,
  // never `.at(-1)`.
  const memEvents = () => events.filter((e) => e.type === 'runtime:memory');

  afterEach(() => {
    setDevtoolsSink(null);
    events = [];
  });

  const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

  it('emits heapBytes + heapLimitBytes from performance.memory', async () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    installMemoryProbe(
      { performance: { memory: { usedJSHeapSize: 1234, jsHeapSizeLimit: 5678 } } },
      10,
    );
    await tick();
    expect(memEvents().some((m: any) => m.heapBytes === 1234 && m.heapLimitBytes === 5678)).toBe(true);
  });

  it('prefers measureUserAgentSpecificMemory and reports sorted contexts', async () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    const perf = {
      memory: { usedJSHeapSize: 1234, jsHeapSizeLimit: 5678 },
      measureUserAgentSpecificMemory: async () => ({
        bytes: 9000,
        breakdown: [
          { bytes: 10, attribution: [{ url: 'https://x/worker.js', scope: 'Window' }] },
          { bytes: 50, attribution: [{ url: 'https://x/main.js' }] },
          { bytes: 30 },
        ],
      }),
    };
    // The measure path clamps its interval to ≥4s (the measurement may GC)
    // — fake timers reach the first tick instantly.
    vi.useFakeTimers();
    installMemoryProbe({ performance: perf }, 10);
    await vi.advanceTimersByTimeAsync(4100);
    vi.useRealTimers();
    const m = memEvents().find((m: any) => m.heapBytes === 9000) as any;
    expect(m).toBeTruthy();
    expect(m.heapLimitBytes).toBe(5678);
    // Sorted desc, attribution projected to {scope,url}.
    expect(m.contexts[0]).toEqual({ bytes: 50, scope: undefined, url: 'https://x/main.js' });
    expect(m.contexts[1].bytes).toBe(30);
    expect(m.contexts[2]).toEqual({ bytes: 10, scope: 'Window', url: 'https://x/worker.js' });
  });

  it('falls back to performance.memory when the measurement rejects', async () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    const perf = {
      memory: { usedJSHeapSize: 777, jsHeapSizeLimit: 999 },
      measureUserAgentSpecificMemory: () => Promise.reject(new Error('denied')),
    };
    vi.useFakeTimers();
    installMemoryProbe({ performance: perf }, 10);
    await vi.advanceTimersByTimeAsync(4100);
    vi.useRealTimers();
    expect(memEvents().some((m: any) => m.heapBytes === 777 && m.heapLimitBytes === 999)).toBe(true);
  });

  it('installs once per scope and no-ops without any memory API', async () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    const scope = { performance: { memory: { usedJSHeapSize: 4242, jsHeapSizeLimit: 8484 } } };
    installMemoryProbe(scope, 10);
    installMemoryProbe(scope, 10); // WeakSet dedupe — second call returns early
    await tick();
    expect(memEvents().some((m: any) => m.heapBytes === 4242)).toBe(true);

    // No perf at all → immediate return, nothing installed.
    installMemoryProbe({}, 10);
    installMemoryProbe({ performance: {} } satisfies object, 10);
    // process.memoryUsage exists under vitest, so only the bare-scope call
    // is guaranteed inert — assert no crash rather than zero events.
  });
});

describe('installFetchProbe', () => {
  let events: EmittedDevtoolsEvent[];
  const ofType = <T extends DevtoolsEvent['type']>(t: T) =>
    events.filter((e) => e.type === t) as Extract<EmittedDevtoolsEvent, { type: T }>[];

  afterEach(() => {
    vi.unstubAllGlobals();
    setDevtoolsSink(null);
    events = [];
  });

  const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

  const jsonResponse = (status = 200, body = '{"ok":true}') =>
    new Response(body, { status, headers: { 'content-type': 'application/json', 'content-length': String(body.length) } });

  /**
   * findTiming polls the resource buffer up to 12×250ms for an entry —
   * stubbing getEntriesByType away makes it bail immediately so detail
   * events land within a test tick.
   */
  const noResourceTiming = () =>
    vi.stubGlobal('performance', { now: () => Date.now() });

  it('emits net:fetch on success and a detail with headers + body preview', async () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    noResourceTiming();
    const scope = { fetch: vi.fn(async () => jsonResponse()) };
    installFetchProbe(scope as unknown as { fetch: typeof fetch });

    const res = await scope.fetch('https://api.test/data', { method: 'post', body: 'q=1' });
    expect(res.status).toBe(200);
    const f = ofType('net:fetch').at(-1)!;
    expect(f).toMatchObject({ url: 'https://api.test/data', method: 'POST', status: 200 });
    expect(f.ms).toBeGreaterThanOrEqual(0);
    expect(f.bytes).toBeGreaterThan(0);
    expect(f.reqBody).toBe('q=1');

    await tick();
    const d = ofType('net:fetch-detail').find((x) => x.id === f.id)!;
    expect(d.resHeaders).toContainEqual(['content-type', 'application/json']);
    expect(d.resBody).toContain('"ok"');
  });

  it('emits net:fetch with the error and rethrows on failure', async () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    const scope = { fetch: vi.fn(async () => { throw new TypeError('boom'); }) };
    installFetchProbe(scope as unknown as { fetch: typeof fetch });

    await expect(scope.fetch('https://api.test/x')).rejects.toThrow('boom');
    const f = ofType('net:fetch').at(-1)!;
    expect(f.error).toBe('boom');
    expect(f.status).toBeUndefined();
  });

  it('reads the body from a Request clone when no init body is given', async () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    noResourceTiming();
    const scope = { fetch: vi.fn(async () => jsonResponse()) };
    installFetchProbe(scope as unknown as { fetch: typeof fetch });

    const req = new Request('https://api.test/r', {
      method: 'PUT',
      headers: { 'x-a': 'b' },
      body: 'request-body',
      duplex: 'half',
    } as RequestInit);
    await scope.fetch(req);
    const f = ofType('net:fetch').at(-1)!;
    expect(f.method).toBe('PUT');
    expect(f.url).toBe('https://api.test/r');
    expect(f.reqHeaders).toContainEqual(['x-a', 'b']);
    await tick();
    expect(ofType('net:fetch-detail').find((d) => d.id === f.id)?.reqBody).toBe('request-body');
  });

  it('describes non-text request bodies without dumping them', async () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    noResourceTiming();
    const scope = { fetch: vi.fn(async () => jsonResponse()) };
    installFetchProbe(scope as unknown as { fetch: typeof fetch });

    await scope.fetch('https://a/1', { method: 'post', body: new URLSearchParams('a=1') });
    await scope.fetch('https://a/2', { method: 'post', body: new Blob(['x'], { type: 'image/png' }) });
    await scope.fetch('https://a/3', { method: 'post', body: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer });
    await scope.fetch('https://a/4', { method: 'post', body: new Uint8Array([1, 2]) });
    await scope.fetch('https://a/5', { method: 'post', body: new FormData() });
    const bodies = ofType('net:fetch').map((e) => e.reqBody);
    expect(bodies[0]).toBe('a=1');
    expect(bodies[1]).toBe('[image/png 1B]');
    expect(bodies[2]).toBe('[ArrayBuffer 3B]');
    expect(bodies[3]).toBe('[Uint8Array 2B]');
    expect(bodies[4]).toBe('[FormData]');
  });

  it('is idempotent — a probed fetch is never wrapped twice', () => {
    const scope = { fetch: vi.fn(async () => jsonResponse()) };
    installFetchProbe(scope as unknown as { fetch: typeof fetch });
    const wrapped = scope.fetch;
    installFetchProbe(scope as unknown as { fetch: typeof fetch });
    expect(scope.fetch).toBe(wrapped);
  });

  it('attaches resource-timing stage data when the entry exists', async () => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    const scope = { fetch: vi.fn(async () => jsonResponse()) };
    installFetchProbe(scope as unknown as { fetch: typeof fetch });
    const t0 = performance.now();
    const entry = {
      name: 'https://api.test/timed',
      startTime: t0,
      fetchStart: t0 + 1, domainLookupStart: t0 + 2, domainLookupEnd: t0 + 5,
      connectStart: t0 + 6, secureConnectionStart: t0 + 8, connectEnd: t0 + 12,
      requestStart: t0 + 13, responseStart: t0 + 20, responseEnd: t0 + 30,
      transferSize: 100, encodedBodySize: 80, decodedBodySize: 200,
    };
    const perf = globalThis.performance as Performance;
    const orig = perf.getEntriesByType?.bind(perf);
    vi.stubGlobal('performance', {
      ...perf,
      now: perf.now.bind(perf),
      getEntriesByType: (type: string) => (type === 'resource' ? [entry] : orig?.(type) ?? []),
    });
    await scope.fetch('https://api.test/timed');
    await tick();
    const d = ofType('net:fetch-detail').at(-1)!;
    expect(d.timing).toMatchObject({
      dns: 3,
      tcp: 2,
      tls: 4,
      wait: expect.closeTo(7, 5),
      download: 10,
    });
    expect(d.transferSize).toBe(100);
    expect(d.decodedSize).toBe(200);
  });
});
