import { afterEach, describe, expect, it, vi } from 'vitest';
import { devtoolsEnabled, emitDevtools, setDevtoolsSink, type EmittedDevtoolsEvent } from '@atolljs/core';
import {
  OtelMapper,
  createOtelPipeline,
  createOtlpSender,
  exportOtel,
  localResource,
  type OtelExporter,
} from '../src/otel';

interface Call {
  url: string;
  init: RequestInit;
  body: any;
}

/** A fetch double: replies from a status script (last entry repeats), records every call. */
const mockFetch = (statuses: (number | Error)[] = [200], headers: Record<string, string> = {}) => {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    const s = statuses[Math.min(i++, statuses.length - 1)];
    if (s instanceof Error) throw s;
    return new Response(s === 200 ? '{}' : 'nope', { status: s, headers });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
};

const ev = (e: Record<string, unknown>, at = 1) => ({ ...e, at, thread: 'main' }) as EmittedDevtoolsEvent;
const island = (n: number) => ev({ type: 'island:task', instance: `i${n}`, method: 'flush', ms: 1 });

describe('createOtlpSender', () => {
  it('POSTs JSON to <endpoint>/v1/<signal> with custom headers', async () => {
    const f = mockFetch();
    const s = createOtlpSender({ endpoint: 'http://collector:4318/', headers: { authorization: 'Bearer x' }, fetch: f.fetch });
    expect(await s.send('traces', { resourceSpans: [] })).toBe(true);
    expect(f.calls[0].url).toBe('http://collector:4318/v1/traces');
    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].init.headers).toMatchObject({ 'content-type': 'application/json', authorization: 'Bearer x' });
    expect(f.calls[0].body).toEqual({ resourceSpans: [] });
  });

  it('defaults to localhost:4318', () => {
    expect(createOtlpSender({ fetch: mockFetch().fetch }).endpoint).toBe('http://localhost:4318');
  });

  it('retries 429/503 honoring Retry-After, then succeeds', async () => {
    const f = mockFetch([503, 429, 200], { 'retry-after': '0' });
    const s = createOtlpSender({ fetch: f.fetch });
    expect(await s.send('metrics', {})).toBe(true);
    expect(f.calls).toHaveLength(3);
  });

  it('retries network failures with backoff and gives up after maxRetries', async () => {
    const f = mockFetch([new TypeError('ECONNREFUSED')]);
    const onError = vi.fn();
    const s = createOtlpSender({ fetch: f.fetch, maxRetries: 2, retryBaseMs: 1, onError });
    expect(await s.send('logs', {})).toBe(false);
    expect(f.calls).toHaveLength(3);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toMatch(/ECONNREFUSED.*3 attempts/);
    expect(onError.mock.calls[0][1]).toBe('logs');
  });

  it('backs off exponentially when no Retry-After is sent', async () => {
    vi.useFakeTimers();
    try {
      const f = mockFetch([502, 502, 200]);
      const s = createOtlpSender({ fetch: f.fetch, retryBaseMs: 1000 });
      const done = s.send('traces', {});
      await vi.advanceTimersByTimeAsync(0);
      expect(f.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000); // attempt 0 backoff ≤ 1000ms
      expect(f.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(499);
      // attempt 1 waits between 1000 and 2000ms: not yet at 499ms
      expect(f.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1600);
      expect(await done).toBe(true);
      expect(f.calls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a 400 and never throws, even from onError', async () => {
    const f = mockFetch([400]);
    const s = createOtlpSender({ fetch: f.fetch, onError: () => { throw new Error('bad callback'); } });
    await expect(s.send('traces', {})).resolves.toBe(false);
    expect(f.calls).toHaveLength(1);
  });

  it('uses keepalive only for bodies under the 64KiB budget', async () => {
    const f = mockFetch();
    const s = createOtlpSender({ fetch: f.fetch });
    await s.send('traces', { x: 1 }, { keepalive: true });
    await s.send('traces', { x: 'y'.repeat(70_000) }, { keepalive: true });
    expect(f.calls[0].init.keepalive).toBe(true);
    expect(f.calls[1].init.keepalive).toBe(false);
  });
});

describe('createOtelPipeline', () => {
  const resource = localResource('pipe');
  const make = (f: ReturnType<typeof mockFetch>, o: Partial<Parameters<typeof createOtelPipeline>[0]> = {}) =>
    createOtelPipeline({
      sender: createOtlpSender({ fetch: f.fetch }),
      newMapper: () => new OtelMapper({ resource, originMs: 0 }),
      flushIntervalMs: 0,
      ...o,
    });

  it('splits queued spans into maxBatch-sized requests and sends one metrics snapshot', async () => {
    const f = mockFetch();
    const p = make(f, { maxBatch: 10 });
    for (let n = 0; n < 25; n++) p.ingest(island(n), 0);
    p.ingest(ev({ type: 'memory:write', path: 'a', version: 1 }), 0);
    await p.flush();
    // 25 ingests with maxBatch 10 already triggered early flushes; total spans are what matter
    const traces = f.calls.filter((c) => c.url.endsWith('/v1/traces'));
    const spans = traces.flatMap((c) => c.body.resourceSpans[0].scopeSpans[0].spans);
    expect(spans).toHaveLength(25);
    expect(traces.every((c) => c.body.resourceSpans[0].scopeSpans[0].spans.length <= 10)).toBe(true);
    const metrics = f.calls.filter((c) => c.url.endsWith('/v1/metrics'));
    expect(metrics.length).toBeGreaterThanOrEqual(1);
    expect(metrics.at(-1)!.body.resourceMetrics[0].resource.attributes).toContainEqual({
      key: 'service.name', value: { stringValue: 'pipe' },
    });
  });

  it('flushes early once a batch fills', async () => {
    const f = mockFetch();
    const p = make(f, { maxBatch: 3 });
    for (let n = 0; n < 3; n++) p.ingest(island(n), 0);
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.endsWith('/v1/traces'))).toBe(true));
  });

  it('flushes on its interval', async () => {
    vi.useFakeTimers();
    try {
      const f = mockFetch();
      const p = make(f, { flushIntervalMs: 1000 });
      p.ingest(island(1), 0);
      await vi.advanceTimersByTimeAsync(999);
      expect(f.calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.calls.some((c) => c.url.endsWith('/v1/traces'))).toBe(true);
      await p.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes flushes and swallows transport failures', async () => {
    const f = mockFetch([new TypeError('down')]);
    const p = createOtelPipeline({
      sender: createOtlpSender({ fetch: f.fetch, maxRetries: 0 }),
      newMapper: () => new OtelMapper({ resource, originMs: 0 }),
      flushIntervalMs: 0,
      signals: { metrics: false },
    });
    p.ingest(island(1), 0);
    await expect(Promise.all([p.flush(), p.flush()])).resolves.toBeDefined();
    expect(f.calls).toHaveLength(1); // the failed batch is dropped, not re-queued
  });

  it('keeps one resource per key and releases a key after its data ships', async () => {
    const f = mockFetch();
    const p = createOtelPipeline({
      sender: createOtlpSender({ fetch: f.fetch }),
      newMapper: (key) => new OtelMapper({ resource: localResource(key), originMs: 0 }),
      flushIntervalMs: 0,
      signals: { metrics: false },
    });
    p.ingest(island(1), 0, 'app-a');
    p.ingest(island(2), 0, 'app-b');
    p.release('app-a');
    await p.flush();
    expect(f.calls[0].body.resourceSpans).toHaveLength(2);
    p.ingest(island(3), 0, 'app-b');
    await p.flush();
    expect(f.calls[1].body.resourceSpans).toHaveLength(1);
  });

  it('ignores ingest after close', async () => {
    const f = mockFetch();
    const p = make(f, { signals: { metrics: false } });
    await p.close();
    p.ingest(island(1), 0);
    await p.flush();
    expect(f.calls).toHaveLength(0);
  });
});

describe('exportOtel', () => {
  let exp: OtelExporter | undefined;
  afterEach(async () => {
    await exp?.close();
    exp = undefined;
    setDevtoolsSink(null);
  });

  const start = (f: ReturnType<typeof mockFetch>, o: Parameters<typeof exportOtel>[0] = {}) =>
    (exp = exportOtel({ fetch: f.fetch, serviceName: 'svc', flushIntervalMs: 0, network: false, memory: false, jank: false, ...o }));

  it('installs as an additive sink and exports task spans, metrics and logs', async () => {
    const f = mockFetch();
    const transport: EmittedDevtoolsEvent[] = [];
    setDevtoolsSink((e) => transport.push(e));
    start(f, { resource: { 'deployment.environment.name': 'test' } });
    emitDevtools({ type: 'task:enqueue', poolId: 'pool-x', callId: 1, taskId: 'ping' });
    emitDevtools({ type: 'task:dispatch', poolId: 'pool-x', callId: 1, taskId: 'ping', slot: 0, waitMs: 1 });
    emitDevtools({ type: 'task:settle', poolId: 'pool-x', callId: 1, taskId: 'ping', outcome: 'ok', runMs: 2 });
    emitDevtools({ type: 'log', level: 'warn', scope: 'test', message: 'careful' });
    await exp!.flush();

    expect(transport).toHaveLength(4); // the dashboard transport still sees everything
    const byPath = (p: string) => f.calls.find((c) => c.url.endsWith(p))!.body;
    const rs = byPath('/v1/traces').resourceSpans[0];
    expect(rs.resource.attributes).toEqual(expect.arrayContaining([
      { key: 'service.name', value: { stringValue: 'svc' } },
      { key: 'telemetry.sdk.name', value: { stringValue: 'atoll' } },
      { key: 'deployment.environment.name', value: { stringValue: 'test' } },
    ]));
    const span = rs.scopeSpans[0].spans[0];
    expect(span.name).toBe('atoll.task ping');
    // real clock: start/end land near now, as ns strings
    const startMs = Number(BigInt(span.startTimeUnixNano) / 1_000_000n);
    expect(Math.abs(startMs - Date.now())).toBeLessThan(5000);
    expect(byPath('/v1/metrics').resourceMetrics[0].scopeMetrics[0].metrics.map((m: any) => m.name)).toContain('atoll.task.settled');
    expect(byPath('/v1/logs').resourceLogs[0].scopeLogs[0].logRecords[0]).toMatchObject({ severityNumber: 13, body: { stringValue: 'careful' } });
  });

  it('respects signal selection', async () => {
    const f = mockFetch();
    start(f, { signals: { traces: false, metrics: false } });
    emitDevtools({ type: 'island:task', instance: 'a@1', method: 'flush', ms: 1 });
    emitDevtools({ type: 'log', level: 'info', scope: 's', message: 'm' });
    await exp!.flush();
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(['/v1/logs']);
  });

  it('close() uninstalls the listener and ships the tail', async () => {
    const f = mockFetch();
    start(f, { signals: { metrics: false } });
    expect(devtoolsEnabled()).toBe(true);
    emitDevtools({ type: 'island:task', instance: 'a@1', method: 'flush', ms: 1 });
    await exp!.close();
    expect(devtoolsEnabled()).toBe(false);
    expect(f.calls).toHaveLength(1);
    emitDevtools({ type: 'island:task', instance: 'a@1', method: 'flush', ms: 1 });
    await exp!.flush();
    expect(f.calls).toHaveLength(1);
  });

  it('flushes on process beforeExit in Node', async () => {
    const f = mockFetch();
    start(f, { signals: { metrics: false } });
    emitDevtools({ type: 'island:task', instance: 'a@1', method: 'flush', ms: 1 });
    process.emit('beforeExit', 0);
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  });

  it('never throws into app code when the backend is down', async () => {
    const f = mockFetch([new TypeError('down')]);
    start(f, { maxRetries: 0 });
    expect(() => emitDevtools({ type: 'island:task', instance: 'a@1', method: 'flush', ms: 1 })).not.toThrow();
    await expect(exp!.flush()).resolves.toBeUndefined();
  });
});
