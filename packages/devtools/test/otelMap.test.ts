import { describe, expect, it } from 'vitest';
import type { EmittedDevtoolsEvent } from '@atolljs/core';
import {
  ClockRebaser,
  OtelMapper,
  SEVERITY,
  encodeLogs,
  encodeMetrics,
  encodeTraces,
  newSpanId,
  newTraceId,
  toAttributes,
  toUnixNano,
  type KeyValue,
  type OtlpMetric,
} from '../src/otelMap';

const ORIGIN = 1_700_000_000_000;
const resource = toAttributes({ 'service.name': 'test' });
const ev = (e: Record<string, unknown>, at: number, extra: Partial<EmittedDevtoolsEvent> = {}) =>
  ({ ...e, at, thread: 'main', ...extra }) as EmittedDevtoolsEvent;
const mapper = (o: Partial<ConstructorParameters<typeof OtelMapper>[0]> = {}) =>
  new OtelMapper({ resource, originMs: ORIGIN, ...o });
const attrOf = (attrs: KeyValue[], key: string) => attrs.find((a) => a.key === key)?.value;
const metric = (ms: OtlpMetric[], name: string) => ms.find((m) => m.name === name)!;

describe('otel primitives', () => {
  it('ids are lowercase hex of the spec widths and never all-zero', () => {
    for (let i = 0; i < 50; i++) {
      expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
      expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(newTraceId()).not.toMatch(/^0+$/);
  });

  it('timestamps are nanosecond decimal strings without float overflow', () => {
    expect(toUnixNano(ORIGIN)).toBe('1700000000000000000');
    expect(toUnixNano(ORIGIN + 1.5)).toBe('1700000000001500000');
    expect(toUnixNano(0.000001)).toBe('1');
    expect(toUnixNano(ORIGIN + 0.9999999)).toBe('1700000000001000000');
  });

  it('typed attributes: int64 as string, doubles as numbers', () => {
    expect(toAttributes({ a: 'x', b: 3, c: 1.5, d: true, e: undefined })).toEqual([
      { key: 'a', value: { stringValue: 'x' } },
      { key: 'b', value: { intValue: '3' } },
      { key: 'c', value: { doubleValue: 1.5 } },
      { key: 'd', value: { boolValue: true } },
    ]);
  });

  it('wraps payloads in the resource/scope envelopes', () => {
    expect(encodeTraces([{ resource, spans: [] }])).toEqual({
      resourceSpans: [{ resource: { attributes: resource }, scopeSpans: [{ scope: { name: '@atolljs/devtools' }, spans: [] }] }],
    });
    expect(encodeMetrics([{ resource, metrics: [] }]).resourceMetrics[0].scopeMetrics[0]).toHaveProperty('metrics');
    expect(encodeLogs([{ resource, logs: [] }]).resourceLogs[0].scopeLogs[0]).toHaveProperty('logRecords');
  });
});

describe('ClockRebaser', () => {
  it('converts main-thread events exactly from the time origin', () => {
    expect(new ClockRebaser(ORIGIN).epochMs({ at: 10, thread: 'main' }, 0)).toBe(ORIGIN + 10);
  });

  it('rebases a worker clock by the least-latency delivery and keeps durations', () => {
    const c = new ClockRebaser(ORIGIN);
    const w = { poolId: 'pool-1', slot: 0 };
    // worker origin is 5000ms after main's; first delivery has 3ms latency, second 1ms
    const workerOrigin = ORIGIN + 5000;
    expect(c.epochMs({ at: 100, thread: 'worker', worker: w }, workerOrigin + 103)).toBe(workerOrigin + 103);
    expect(c.epochMs({ at: 200, thread: 'worker', worker: w }, workerOrigin + 201)).toBe(workerOrigin + 201);
    // a slow delivery doesn't move the estimate
    expect(c.epochMs({ at: 300, thread: 'worker', worker: w }, workerOrigin + 350)).toBe(workerOrigin + 301);
  });

  it('re-seeds when a reused slot reports a fresh clock', () => {
    const c = new ClockRebaser(ORIGIN);
    const w = { poolId: 'pool-1', slot: 0 };
    c.epochMs({ at: 10_000, thread: 'worker', worker: w }, ORIGIN + 10_001);
    // respawned worker: at restarts near 0 while wall time moved on
    expect(c.epochMs({ at: 5, thread: 'worker', worker: w }, ORIGIN + 20_006)).toBe(ORIGIN + 20_006);
  });

  it('estimates unknown origins (remote sessions) the same way', () => {
    const c = new ClockRebaser();
    expect(c.epochMs({ at: 50, thread: 'main' }, ORIGIN + 60)).toBe(ORIGIN + 60);
    expect(c.epochMs({ at: 70, thread: 'main' }, ORIGIN + 75)).toBe(ORIGIN + 75);
    expect(c.epochMs({ at: 80, thread: 'main' }, ORIGIN + 200)).toBe(ORIGIN + 85);
  });
});

describe('OtelMapper traces', () => {
  const runCall = (m: OtelMapper, outcome = 'ok', error?: string) => {
    m.ingest(ev({ type: 'task:enqueue', poolId: 'pool-1', callId: 7, taskId: 'search' }, 100), 0);
    m.ingest(ev({ type: 'task:dispatch', poolId: 'pool-1', callId: 7, taskId: 'search', slot: 2, waitMs: 4, argBytes: 64 }, 104), 0);
    m.ingest(ev({ type: 'task:settle', poolId: 'pool-1', callId: 7, taskId: 'search', outcome, runMs: 10, resultBytes: 128, error }, 114), 0);
  };

  it('builds one CLIENT span per task call from enqueue → settle', () => {
    const m = mapper();
    runCall(m);
    const [s] = m.takeSpans(10);
    expect(s.name).toBe('atoll.task search');
    expect(s.kind).toBe(3);
    expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(s.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(s.startTimeUnixNano).toBe(toUnixNano(ORIGIN + 100));
    expect(s.endTimeUnixNano).toBe(toUnixNano(ORIGIN + 114));
    expect(attrOf(s.attributes, 'atoll.pool.id')).toEqual({ stringValue: 'pool-1' });
    expect(attrOf(s.attributes, 'atoll.task.id')).toEqual({ stringValue: 'search' });
    expect(attrOf(s.attributes, 'atoll.worker.slot')).toEqual({ intValue: '2' });
    expect(attrOf(s.attributes, 'atoll.queue_wait_ms')).toEqual({ doubleValue: 4 });
    expect(attrOf(s.attributes, 'atoll.run_ms')).toEqual({ doubleValue: 10 });
    expect(attrOf(s.attributes, 'atoll.arg_bytes')).toEqual({ intValue: '64' });
    expect(attrOf(s.attributes, 'atoll.result_bytes')).toEqual({ intValue: '128' });
    expect(attrOf(s.attributes, 'atoll.outcome')).toEqual({ stringValue: 'ok' });
    expect(s.status).toBeUndefined(); // instrumentation leaves success UNSET
    expect(s.events?.[0]).toMatchObject({ name: 'atoll.dispatch', timeUnixNano: toUnixNano(ORIGIN + 104) });
  });

  it('marks failed outcomes ERROR with the message; aborted stays unset', () => {
    const m = mapper();
    runCall(m, 'error', 'boom');
    expect(m.takeSpans(1)[0].status).toEqual({ code: 2, message: 'boom' });
    runCall(m, 'timeout');
    expect(m.takeSpans(1)[0].status).toEqual({ code: 2, message: 'timeout' });
    runCall(m, 'aborted');
    expect(m.takeSpans(1)[0].status).toBeUndefined();
  });

  it('falls back to settle − runMs when the enqueue was missed', () => {
    const m = mapper();
    m.ingest(ev({ type: 'task:settle', poolId: 'p', callId: 1, taskId: 't', outcome: 'ok', runMs: 20 }, 50), 0);
    expect(m.takeSpans(1)[0].startTimeUnixNano).toBe(toUnixNano(ORIGIN + 30));
  });

  it('island round trips become spans', () => {
    const m = mapper();
    m.ingest(ev({ type: 'island:task', instance: 'chart@1', method: 'dispatch', ms: 6, ops: 12 }, 40), 0);
    const [s] = m.takeSpans(1);
    expect(s.name).toBe('atoll.island chart@1 dispatch');
    expect(s.startTimeUnixNano).toBe(toUnixNano(ORIGIN + 34));
    expect(attrOf(s.attributes, 'atoll.island.ops')).toEqual({ intValue: '12' });
  });

  it('net:fetch follows HTTP client semconv', () => {
    const m = mapper();
    m.ingest(ev({ type: 'net:fetch', id: 1, url: 'https://u:p@api.test:8443/x?q=1', method: 'GET', status: 503, ms: 9 }, 20), 0);
    m.ingest(ev({ type: 'net:fetch', id: 2, url: '/rel', method: 'PROPFIND', ms: 2, error: 'Failed to fetch' }, 30), 0);
    const [a, b] = m.takeSpans(10);
    expect(a.name).toBe('GET');
    expect(attrOf(a.attributes, 'http.request.method')).toEqual({ stringValue: 'GET' });
    expect(attrOf(a.attributes, 'url.full')).toEqual({ stringValue: 'https://REDACTED:REDACTED@api.test:8443/x?q=1' });
    expect(attrOf(a.attributes, 'server.address')).toEqual({ stringValue: 'api.test' });
    expect(attrOf(a.attributes, 'server.port')).toEqual({ intValue: '8443' });
    expect(attrOf(a.attributes, 'http.response.status_code')).toEqual({ intValue: '503' });
    expect(attrOf(a.attributes, 'error.type')).toEqual({ stringValue: '503' });
    expect(a.status).toEqual({ code: 2 });
    expect(b.name).toBe('HTTP');
    expect(attrOf(b.attributes, 'http.request.method')).toEqual({ stringValue: '_OTHER' });
    expect(attrOf(b.attributes, 'http.request.method_original')).toEqual({ stringValue: 'PROPFIND' });
    expect(b.status).toEqual({ code: 2, message: 'Failed to fetch' });
  });

  it('skips the exporter’s own requests', () => {
    const m = mapper({ ignoreUrl: (u) => u.startsWith('http://localhost:4318') });
    m.ingest(ev({ type: 'net:fetch', id: 1, url: 'http://localhost:4318/v1/traces', method: 'POST', status: 200, ms: 1 }, 1), 0);
    expect(m.spans).toHaveLength(0);
  });

  it('drops the oldest span past maxQueue', () => {
    const m = mapper({ maxQueue: 2 });
    for (const ms of [1, 2, 3]) m.ingest(ev({ type: 'island:task', instance: `i${ms}`, method: 'flush', ms }, 10), 0);
    expect(m.spans.map((s) => s.name)).toEqual(['atoll.island i2 flush', 'atoll.island i3 flush']);
    expect(m.dropped).toBe(1);
  });

  it('respects signals.traces = false', () => {
    const m = mapper({ signals: { traces: false } });
    runCall(m);
    expect(m.spans).toHaveLength(0);
  });
});

describe('OtelMapper metrics', () => {
  it('aggregates cumulative sums, histograms and gauges', () => {
    const m = mapper();
    for (let i = 0; i < 3; i++) {
      m.ingest(ev({ type: 'task:enqueue', poolId: 'p', callId: i, taskId: 't' }, 10), 0);
      m.ingest(ev({ type: 'task:dispatch', poolId: 'p', callId: i, taskId: 't', slot: 0, waitMs: 3 }, 13), 0);
    }
    m.ingest(ev({ type: 'task:settle', poolId: 'p', callId: 0, taskId: 't', outcome: 'ok', runMs: 7 }, 20), 0);
    m.ingest(ev({ type: 'task:settle', poolId: 'p', callId: 1, taskId: 't', outcome: 'error', runMs: 700 }, 20), 0);
    m.ingest(ev({ type: 'memory:write', path: 'count', version: 1 }, 1), 0);
    m.ingest(ev({ type: 'memory:write', path: 'count', version: 2 }, 2), 0);
    m.ingest(ev({ type: 'runtime:memory', heapBytes: 1000 }, 1), 0);
    m.ingest(ev({ type: 'runtime:memory', heapBytes: 2000, rssBytes: 9000 }, 1, { thread: 'worker', worker: { poolId: 'p', slot: 1 } }), ORIGIN + 5);
    m.ingest(ev({ type: 'runtime:longframe', ms: 120, blockingMs: 70 }, 1), 0);
    m.ingest(ev({ type: 'island:ops', instance: 'a@1', via: 'mount', count: 40 }, 1), 0);

    const out = m.collectMetrics(ORIGIN + 1000);
    const now = toUnixNano(ORIGIN + 1000);

    const settled = metric(out, 'atoll.task.settled');
    expect(settled.sum).toMatchObject({ aggregationTemporality: 2, isMonotonic: true });
    expect(settled.sum!.dataPoints).toHaveLength(2);
    const okPt = settled.sum!.dataPoints.find((d) => {
      const v = attrOf(d.attributes, 'atoll.outcome');
      return !!v && 'stringValue' in v && v.stringValue === 'ok';
    })!;
    expect(okPt.asInt).toBe('1');
    expect(okPt.timeUnixNano).toBe(now);
    expect(okPt.startTimeUnixNano).toBe(toUnixNano(ORIGIN + 20));

    const dur = metric(out, 'atoll.task.duration').histogram!;
    expect(dur.aggregationTemporality).toBe(2);
    const p = dur.dataPoints[0];
    expect(p.count).toBe('2');
    expect(p.sum).toBe(707);
    expect(p.min).toBe(7);
    expect(p.max).toBe(700);
    expect(p.bucketCounts).toHaveLength(p.explicitBounds.length + 1);
    expect(p.bucketCounts.every((c) => typeof c === 'string')).toBe(true);
    // 7 → (5,10]; 700 → (500,1000]
    expect(p.bucketCounts[p.explicitBounds.indexOf(10)]).toBe('1');
    expect(p.bucketCounts[p.explicitBounds.indexOf(1000)]).toBe('1');

    expect(metric(out, 'atoll.task.queue_wait').histogram!.dataPoints[0].count).toBe('3');
    // callIds 0 and 1 settled; 2 is still in flight
    expect(metric(out, 'atoll.task.in_flight').gauge!.dataPoints[0].asInt).toBe('1');
    expect(metric(out, 'atoll.memory.writes').sum!.dataPoints[0]).toMatchObject({
      asInt: '2', attributes: [{ key: 'atoll.memory.field', value: { stringValue: 'count' } }],
    });
    const heap = metric(out, 'atoll.runtime.heap').gauge!.dataPoints;
    expect(heap).toHaveLength(2);
    expect(heap.find((d) => attrOf(d.attributes, 'atoll.worker'))?.asInt).toBe('2000');
    expect(metric(out, 'atoll.runtime.rss').gauge!.dataPoints[0].asInt).toBe('9000');
    expect(metric(out, 'atoll.runtime.long_frames').sum!.dataPoints[0].asInt).toBe('1');
    expect(metric(out, 'atoll.runtime.blocking').sum!.dataPoints[0].asDouble).toBe(70);
    expect(metric(out, 'atoll.island.ops').sum!.dataPoints[0].asInt).toBe('40');
  });

  it('stays cumulative across collections', () => {
    const m = mapper();
    m.ingest(ev({ type: 'memory:write', path: 'a', version: 1 }, 1), 0);
    expect(metric(m.collectMetrics(ORIGIN + 10), 'atoll.memory.writes').sum!.dataPoints[0].asInt).toBe('1');
    m.ingest(ev({ type: 'memory:write', path: 'a', version: 2 }, 2), 0);
    const pt = metric(m.collectMetrics(ORIGIN + 20), 'atoll.memory.writes').sum!.dataPoints[0];
    expect(pt.asInt).toBe('2');
    expect(pt.startTimeUnixNano).toBe(toUnixNano(ORIGIN + 1));
  });

  it('caps series per metric', () => {
    const m = mapper({ maxSeries: 2 });
    for (const path of ['a', 'b', 'c']) m.ingest(ev({ type: 'memory:write', path, version: 1 }, 1), 0);
    expect(metric(m.collectMetrics(ORIGIN), 'atoll.memory.writes').sum!.dataPoints).toHaveLength(2);
  });

  it('reports zero in-flight for an idle pool and forgets terminated pools', () => {
    const m = mapper();
    m.ingest(ev({ type: 'pool:init', poolId: 'p', poolSize: 1, concurrency: 1 }, 1), 0);
    expect(metric(m.collectMetrics(ORIGIN), 'atoll.task.in_flight').gauge!.dataPoints[0].asInt).toBe('0');
    m.ingest(ev({ type: 'pool:terminate', poolId: 'p' }, 2), 0);
    expect(m.collectMetrics(ORIGIN).find((x) => x.name === 'atoll.task.in_flight')).toBeUndefined();
  });

  it('collects nothing when metrics are off', () => {
    const m = mapper({ signals: { metrics: false } });
    m.ingest(ev({ type: 'memory:write', path: 'a', version: 1 }, 1), 0);
    expect(m.collectMetrics(ORIGIN)).toEqual([]);
  });
});

describe('OtelMapper logs', () => {
  it('maps levels to severity numbers and keeps scope/thread attributes', () => {
    const m = mapper();
    const levels = ['trace', 'debug', 'info', 'warn', 'error'] as const;
    for (const level of levels) m.ingest(ev({ type: 'log', level, scope: 'pool', message: `m-${level}`, data: '{"a":1}' }, 5), ORIGIN + 6);
    const logs = m.takeLogs(10);
    expect(logs.map((l) => l.severityNumber)).toEqual([1, 5, 9, 13, 17]);
    expect(logs.map((l) => l.severityText)).toEqual(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR']);
    expect(logs[2].body).toEqual({ stringValue: 'm-info' });
    expect(logs[2].timeUnixNano).toBe(toUnixNano(ORIGIN + 5));
    expect(logs[2].observedTimeUnixNano).toBe(toUnixNano(ORIGIN + 6));
    expect(attrOf(logs[2].attributes, 'atoll.log.scope')).toEqual({ stringValue: 'pool' });
    expect(attrOf(logs[2].attributes, 'atoll.log.data')).toEqual({ stringValue: '{"a":1}' });
    expect(attrOf(logs[2].attributes, 'atoll.thread')).toEqual({ stringValue: 'main' });
    expect(SEVERITY.warn).toBe(13);
  });

  it('worker crashes and respawns become logs and counters', () => {
    const m = mapper();
    m.ingest(ev({ type: 'worker:error', poolId: 'p', slot: 0, message: 'OOM' }, 5), 0);
    m.ingest(ev({ type: 'worker:respawn', poolId: 'p', slot: 0 }, 6), 0);
    const [err, re] = m.takeLogs(10);
    expect(err).toMatchObject({ severityNumber: 17, body: { stringValue: 'worker error: OOM' } });
    expect(re).toMatchObject({ severityNumber: 9, body: { stringValue: 'worker respawned' } });
    const out = m.collectMetrics(ORIGIN);
    expect(metric(out, 'atoll.worker.errors').sum!.dataPoints[0].asInt).toBe('1');
    expect(metric(out, 'atoll.worker.respawns').sum!.dataPoints[0].asInt).toBe('1');
  });
});
