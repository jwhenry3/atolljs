/**
 * Pure devtools-event → OTLP/HTTP JSON mapping (no transport, no globals
 * beyond crypto for ids). `otel.ts` drives it from a devtools sink; the
 * aggregate server drives one mapper per app session.
 *
 * Encoding follows the OTLP JSON Protobuf mapping: lowerCamelCase keys,
 * traceId/spanId as hex strings, enums as integers, 64-bit integers
 * (timestamps, intValue, counts) as decimal strings.
 */
import type { EmittedDevtoolsEvent, TaskSettleOutcome } from '@atolljs/core';

/* ── OTLP JSON shapes ────────────────────────────────────────────────────── */

export type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

export interface KeyValue {
  key: string;
  value: AnyValue;
}

export interface OtlpSpanEvent {
  timeUnixNano: string;
  name: string;
  attributes?: KeyValue[];
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: KeyValue[];
  events?: OtlpSpanEvent[];
  status?: { code: number; message?: string };
}

export interface OtlpLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: AnyValue;
  attributes: KeyValue[];
}

export interface OtlpNumberPoint {
  attributes: KeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano: string;
  asInt?: string;
  asDouble?: number;
}

export interface OtlpHistogramPoint {
  attributes: KeyValue[];
  startTimeUnixNano: string;
  timeUnixNano: string;
  count: string;
  sum: number;
  min: number;
  max: number;
  bucketCounts: string[];
  explicitBounds: number[];
}

export interface OtlpMetric {
  name: string;
  unit: string;
  description: string;
  sum?: { aggregationTemporality: number; isMonotonic: boolean; dataPoints: OtlpNumberPoint[] };
  gauge?: { dataPoints: OtlpNumberPoint[] };
  histogram?: { aggregationTemporality: number; dataPoints: OtlpHistogramPoint[] };
}

/** Span.SpanKind */
export const SPAN_KIND_CLIENT = 3;
/** Status.StatusCode */
export const STATUS_ERROR = 2;
/** AggregationTemporality */
export const TEMPORALITY_CUMULATIVE = 2;
/** SeverityNumber base value per level. */
export const SEVERITY: Record<'trace' | 'debug' | 'info' | 'warn' | 'error', number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};

export const OTEL_SCOPE = { name: '@atolljs/devtools' };

/* ── primitives ──────────────────────────────────────────────────────────── */

export const attr = {
  str: (key: string, v: string): KeyValue => ({ key, value: { stringValue: v } }),
  int: (key: string, v: number): KeyValue => ({ key, value: { intValue: String(Math.trunc(v)) } }),
  dbl: (key: string, v: number): KeyValue => ({ key, value: { doubleValue: v } }),
  bool: (key: string, v: boolean): KeyValue => ({ key, value: { boolValue: v } }),
};

/** Untyped attribute bag → KeyValues: integers as intValue, other numbers as doubleValue. */
export const toAttributes = (bag: Record<string, string | number | boolean | undefined>): KeyValue[] => {
  const out: KeyValue[] = [];
  for (const [k, v] of Object.entries(bag)) {
    if (v === undefined) continue;
    if (typeof v === 'string') out.push(attr.str(k, v));
    else if (typeof v === 'boolean') out.push(attr.bool(k, v));
    else if (Number.isSafeInteger(v)) out.push(attr.int(k, v));
    else if (Number.isFinite(v)) out.push(attr.dbl(k, v));
  }
  return out;
};

/** Epoch milliseconds (fractional) → nanoseconds as a decimal string, without float overflow. */
export const toUnixNano = (epochMs: number): string => {
  let whole = Math.floor(epochMs);
  let frac = Math.round((epochMs - whole) * 1e6);
  if (frac >= 1e6) {
    whole += 1;
    frac -= 1e6;
  }
  return (BigInt(whole) * 1_000_000n + BigInt(frac)).toString();
};

const hex = (bytes: number): string => {
  const a = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(a);
  else for (let i = 0; i < bytes; i++) a[i] = (Math.random() * 256) | 0;
  // All-zero ids are invalid per the trace spec.
  if (a.every((b) => b === 0)) a[bytes - 1] = 1;
  let s = '';
  for (const b of a) s += b.toString(16).padStart(2, '0');
  return s;
};

/** 16 random bytes → 32 hex chars. */
export const newTraceId = (): string => hex(16);
/** 8 random bytes → 16 hex chars. */
export const newSpanId = (): string => hex(8);

/* ── clock ───────────────────────────────────────────────────────────────── */

/**
 * Converts an event's `at` (performance.now() on the emitting thread) to
 * epoch ms. Main-thread events with a known `originMs`
 * (performance.timeOrigin of that thread) convert exactly. Everything else
 * (worker-forwarded events carry the worker's own clock; remote sessions
 * have an unknown origin) is rebased per clock: offset = min over samples
 * of (receive time − at), i.e. the least-latency delivery seen so far.
 * Durations and intra-thread order survive; absolute times are late by at
 * most that minimum delivery latency. A jump of more than `resetMs` above
 * the current estimate is treated as a new clock (a respawned worker in a
 * reused slot) and re-seeds the offset.
 */
export class ClockRebaser {
  private offsets = new Map<string, number>();

  constructor(
    private readonly originMs?: number,
    private readonly resetMs = 1000,
  ) {}

  epochMs(ev: Pick<EmittedDevtoolsEvent, 'at' | 'thread' | 'worker'>, recvEpochMs: number): number {
    if (!ev.worker && this.originMs !== undefined) return this.originMs + ev.at;
    const key = ev.worker ? `${ev.worker.poolId}#${ev.worker.slot}` : ev.thread;
    const d = recvEpochMs - ev.at;
    const cur = this.offsets.get(key);
    const off = cur === undefined || d < cur || d - cur > this.resetMs ? d : cur;
    this.offsets.set(key, off);
    return ev.at + off;
  }
}

/* ── metrics aggregation ─────────────────────────────────────────────────── */

interface Series {
  attrs: KeyValue[];
  startNs: string;
  timeNs: string;
  value: number;
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: number[];
}

type InstrumentKind = 'counter' | 'gauge' | 'histogram';

/** Default ms histogram bounds: sub-ms through 10s. */
export const MS_BOUNDS = [0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

const seriesKey = (attrs: KeyValue[]): string =>
  attrs.map((a) => `${a.key}=${JSON.stringify(a.value)}`).join('|');

class Instrument {
  readonly series = new Map<string, Series>();

  constructor(
    readonly name: string,
    readonly unit: string,
    readonly description: string,
    readonly kind: InstrumentKind,
    readonly int: boolean,
    private readonly maxSeries: number,
    readonly bounds: number[] = MS_BOUNDS,
  ) {}

  private at(attrs: KeyValue[], nowNs: string): Series | undefined {
    const k = seriesKey(attrs);
    let s = this.series.get(k);
    if (!s) {
      // Cardinality cap: new series beyond it are dropped, existing ones keep counting.
      if (this.series.size >= this.maxSeries) return undefined;
      s = {
        attrs, startNs: nowNs, timeNs: nowNs, value: 0, count: 0, sum: 0,
        min: Infinity, max: -Infinity, buckets: new Array(this.bounds.length + 1).fill(0),
      };
      this.series.set(k, s);
    }
    return s;
  }

  add(attrs: KeyValue[], v: number, nowNs: string): void {
    const s = this.at(attrs, nowNs);
    if (s) s.value += v;
  }

  set(attrs: KeyValue[], v: number, nowNs: string): void {
    const s = this.at(attrs, nowNs);
    if (s) {
      s.value = v;
      s.timeNs = nowNs;
    }
  }

  record(attrs: KeyValue[], v: number, nowNs: string): void {
    const s = this.at(attrs, nowNs);
    if (!s) return;
    s.count++;
    s.sum += v;
    if (v < s.min) s.min = v;
    if (v > s.max) s.max = v;
    // Buckets are upper-inclusive: (bounds[i-1], bounds[i]].
    let i = 0;
    while (i < this.bounds.length && v > this.bounds[i]) i++;
    s.buckets[i]++;
  }

  delete(attrs: KeyValue[]): void {
    this.series.delete(seriesKey(attrs));
  }

  encode(nowNs: string): OtlpMetric | null {
    if (this.series.size === 0) return null;
    const base = { name: this.name, unit: this.unit, description: this.description };
    const num = (s: Series): Pick<OtlpNumberPoint, 'asInt' | 'asDouble'> =>
      this.int ? { asInt: String(Math.trunc(s.value)) } : { asDouble: s.value };
    const all = [...this.series.values()];
    if (this.kind === 'counter') {
      return {
        ...base,
        sum: {
          aggregationTemporality: TEMPORALITY_CUMULATIVE,
          isMonotonic: true,
          dataPoints: all.map((s) => ({ attributes: s.attrs, startTimeUnixNano: s.startNs, timeUnixNano: nowNs, ...num(s) })),
        },
      };
    }
    if (this.kind === 'gauge') {
      return {
        ...base,
        gauge: { dataPoints: all.map((s) => ({ attributes: s.attrs, timeUnixNano: s.timeNs, ...num(s) })) },
      };
    }
    const points = all.filter((s) => s.count > 0);
    if (points.length === 0) return null;
    return {
      ...base,
      histogram: {
        aggregationTemporality: TEMPORALITY_CUMULATIVE,
        dataPoints: points.map((s) => ({
          attributes: s.attrs,
          startTimeUnixNano: s.startNs,
          timeUnixNano: nowNs,
          count: String(s.count),
          sum: s.sum,
          min: s.min,
          max: s.max,
          bucketCounts: s.buckets.map(String),
          explicitBounds: this.bounds,
        })),
      },
    };
  }
}

/* ── the mapper ──────────────────────────────────────────────────────────── */

export interface OtelSignals {
  traces?: boolean;
  metrics?: boolean;
  logs?: boolean;
}

export interface OtelMapperOptions {
  /** Resource attributes (service.name, telemetry.sdk.*, …). */
  resource: KeyValue[];
  /** performance.timeOrigin of the main thread, when events come from this process. */
  originMs?: number;
  signals?: OtelSignals;
  /** net:fetch URLs to skip: the exporter's own OTLP posts. */
  ignoreUrl?: (url: string) => boolean;
  /** Queued spans / log records each, oldest dropped past this (default 2048). */
  maxQueue?: number;
  /** Open task calls tracked for correlation (default 10_000, oldest dropped). */
  maxPending?: number;
  /** Series per metric before new attribute sets are dropped (default 2000). */
  maxSeries?: number;
}

interface PendingCall {
  poolId: string;
  taskId: string;
  startMs: number;
  slot?: number;
  waitMs?: number;
  argBytes?: number;
  dispatchMs?: number;
}

const ERROR_OUTCOMES = new Set<TaskSettleOutcome>(['error', 'timeout', 'queue-full', 'crashed']);

const KNOWN_METHODS = new Set(['CONNECT', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE', 'QUERY']);

/** url.full must not carry credentials. */
const redactUrl = (url: string): string => url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1REDACTED:REDACTED@');

const workerKey = (w?: { poolId: string; slot: number }): string | undefined =>
  w ? `${w.poolId}#${w.slot}` : undefined;

export class OtelMapper {
  readonly resource: KeyValue[];
  readonly spans: OtlpSpan[] = [];
  readonly logs: OtlpLogRecord[] = [];
  /** Items dropped by the queue bound since creation. */
  dropped = 0;

  private readonly clock: ClockRebaser;
  private readonly traces: boolean;
  private readonly metricsOn: boolean;
  private readonly logsOn: boolean;
  private readonly maxQueue: number;
  private readonly maxPending: number;
  private readonly ignoreUrl?: (url: string) => boolean;
  private readonly pending = new Map<string, PendingCall>();
  private readonly pools = new Set<string>();
  private readonly instruments: Instrument[] = [];
  private readonly m: Record<
    | 'settled' | 'duration' | 'wait' | 'inFlight' | 'islandOps' | 'heap' | 'rss'
    | 'longFrames' | 'blocking' | 'fps' | 'writes' | 'workerErrors' | 'respawns',
    Instrument
  >;

  constructor(opts: OtelMapperOptions) {
    this.resource = opts.resource;
    this.clock = new ClockRebaser(opts.originMs);
    this.traces = opts.signals?.traces !== false;
    this.metricsOn = opts.signals?.metrics !== false;
    this.logsOn = opts.signals?.logs !== false;
    this.maxQueue = opts.maxQueue ?? 2048;
    this.maxPending = opts.maxPending ?? 10_000;
    this.ignoreUrl = opts.ignoreUrl;
    const cap = opts.maxSeries ?? 2000;
    const mk = (name: string, unit: string, description: string, kind: InstrumentKind, int: boolean) => {
      const i = new Instrument(name, unit, description, kind, int, cap);
      this.instruments.push(i);
      return i;
    };
    this.m = {
      settled: mk('atoll.task.settled', '{call}', 'Task calls settled, by outcome', 'counter', true),
      duration: mk('atoll.task.duration', 'ms', 'Task run time, dispatch to reply', 'histogram', false),
      wait: mk('atoll.task.queue_wait', 'ms', 'Task queue wait, enqueue to dispatch', 'histogram', false),
      inFlight: mk('atoll.task.in_flight', '{call}', 'Task calls enqueued and not yet settled', 'gauge', true),
      islandOps: mk('atoll.island.ops', '{op}', 'Island DOM ops replayed on the main thread', 'counter', true),
      heap: mk('atoll.runtime.heap', 'By', 'JS heap in use, per thread', 'gauge', true),
      rss: mk('atoll.runtime.rss', 'By', 'Resident set size, per thread (Node)', 'gauge', true),
      longFrames: mk('atoll.runtime.long_frames', '{frame}', 'Main-thread frames over the 50ms budget', 'counter', true),
      blocking: mk('atoll.runtime.blocking', 'ms', 'Main-thread time past the 50ms frame budget', 'counter', false),
      fps: mk('atoll.runtime.fps', '{frame}/s', 'Main-thread frame rate', 'gauge', false),
      writes: mk('atoll.memory.writes', '{write}', 'Shared-memory field writes', 'counter', true),
      workerErrors: mk('atoll.worker.errors', '{error}', 'Worker error events', 'counter', true),
      respawns: mk('atoll.worker.respawns', '{respawn}', 'Crashed workers respawned', 'counter', true),
    };
  }

  private pushSpan(s: OtlpSpan): void {
    this.spans.push(s);
    if (this.spans.length > this.maxQueue) {
      this.spans.shift();
      this.dropped++;
    }
  }

  private pushLog(r: OtlpLogRecord): void {
    this.logs.push(r);
    if (this.logs.length > this.maxQueue) {
      this.logs.shift();
      this.dropped++;
    }
  }

  private log(
    level: keyof typeof SEVERITY, body: string, attrs: KeyValue[], tMs: number, recvMs: number,
  ): void {
    if (!this.logsOn) return;
    this.pushLog({
      timeUnixNano: toUnixNano(tMs),
      observedTimeUnixNano: toUnixNano(recvMs),
      severityNumber: SEVERITY[level],
      severityText: level.toUpperCase(),
      body: { stringValue: body },
      attributes: attrs,
    });
  }

  /** Thread attribution shared by logs and runtime metrics. */
  private threadAttrs(ev: EmittedDevtoolsEvent): KeyValue[] {
    const w = workerKey(ev.worker);
    return w ? [attr.str('atoll.thread', 'worker'), attr.str('atoll.worker', w)] : [attr.str('atoll.thread', ev.thread)];
  }

  /** Feed one event; `recvEpochMs` is when the sink saw it (rebases foreign clocks). */
  ingest(ev: EmittedDevtoolsEvent, recvEpochMs: number): void {
    const t = this.clock.epochMs(ev, recvEpochMs);
    const ns = () => toUnixNano(t);
    switch (ev.type) {
      case 'pool:init':
        this.pools.add(ev.poolId);
        return;
      case 'pool:terminate':
        this.pools.delete(ev.poolId);
        if (this.metricsOn) this.m.inFlight.delete([attr.str('atoll.pool.id', ev.poolId)]);
        return;
      case 'task:enqueue': {
        if (!this.traces && !this.metricsOn) return;
        this.pools.add(ev.poolId);
        this.pending.set(`${ev.poolId}:${ev.callId}`, { poolId: ev.poolId, taskId: ev.taskId, startMs: t });
        if (this.pending.size > this.maxPending) this.pending.delete(this.pending.keys().next().value!);
        return;
      }
      case 'task:dispatch': {
        const p = this.pending.get(`${ev.poolId}:${ev.callId}`);
        if (p) {
          p.slot = ev.slot;
          p.waitMs = ev.waitMs;
          p.argBytes = ev.argBytes;
          p.dispatchMs = t;
        }
        if (this.metricsOn) {
          this.m.wait.record([attr.str('atoll.pool.id', ev.poolId), attr.str('atoll.task.id', ev.taskId)], ev.waitMs, ns());
        }
        return;
      }
      case 'task:settle': {
        const key = `${ev.poolId}:${ev.callId}`;
        const p = this.pending.get(key);
        this.pending.delete(key);
        if (this.metricsOn) {
          const base = [attr.str('atoll.pool.id', ev.poolId), attr.str('atoll.task.id', ev.taskId)];
          this.m.settled.add([...base, attr.str('atoll.outcome', ev.outcome)], 1, ns());
          if (ev.runMs !== undefined) this.m.duration.record(base, ev.runMs, ns());
        }
        if (!this.traces) return;
        const attributes = [
          attr.str('atoll.pool.id', ev.poolId),
          attr.str('atoll.task.id', ev.taskId),
          attr.str('atoll.outcome', ev.outcome),
        ];
        if (p?.slot !== undefined) attributes.push(attr.int('atoll.worker.slot', p.slot));
        if (p?.waitMs !== undefined) attributes.push(attr.dbl('atoll.queue_wait_ms', p.waitMs));
        if (ev.runMs !== undefined) attributes.push(attr.dbl('atoll.run_ms', ev.runMs));
        if (p?.argBytes !== undefined) attributes.push(attr.int('atoll.arg_bytes', p.argBytes));
        if (ev.resultBytes !== undefined) attributes.push(attr.int('atoll.result_bytes', ev.resultBytes));
        const fwd = workerKey(ev.worker);
        if (fwd) attributes.push(attr.str('atoll.worker', fwd));
        const span: OtlpSpan = {
          traceId: newTraceId(),
          spanId: newSpanId(),
          name: `atoll.task ${ev.taskId}`,
          kind: SPAN_KIND_CLIENT,
          startTimeUnixNano: toUnixNano(p?.startMs ?? t - (ev.runMs ?? 0)),
          endTimeUnixNano: ns(),
          attributes,
        };
        if (p?.dispatchMs !== undefined) {
          span.events = [{
            timeUnixNano: toUnixNano(p.dispatchMs),
            name: 'atoll.dispatch',
            attributes: [attr.int('atoll.worker.slot', p.slot ?? -1), attr.dbl('atoll.queue_wait_ms', p.waitMs ?? 0)],
          }];
        }
        if (ERROR_OUTCOMES.has(ev.outcome)) span.status = { code: STATUS_ERROR, message: ev.error ?? ev.outcome };
        this.pushSpan(span);
        return;
      }
      case 'island:task': {
        if (!this.traces) return;
        const attributes = [attr.str('atoll.island.instance', ev.instance), attr.str('atoll.island.method', ev.method)];
        if (ev.ops !== undefined) attributes.push(attr.int('atoll.island.ops', ev.ops));
        const span: OtlpSpan = {
          traceId: newTraceId(),
          spanId: newSpanId(),
          name: `atoll.island ${ev.instance} ${ev.method}`,
          kind: SPAN_KIND_CLIENT,
          startTimeUnixNano: toUnixNano(t - ev.ms),
          endTimeUnixNano: ns(),
          attributes,
        };
        if (ev.error !== undefined) span.status = { code: STATUS_ERROR, message: ev.error };
        this.pushSpan(span);
        return;
      }
      case 'island:ops':
        if (this.metricsOn) {
          this.m.islandOps.add(
            [attr.str('atoll.island.instance', ev.instance), attr.str('atoll.island.via', ev.via)], ev.count, ns(),
          );
        }
        return;
      case 'net:fetch': {
        if (!this.traces || this.ignoreUrl?.(ev.url)) return;
        const known = KNOWN_METHODS.has(ev.method);
        const attributes = [attr.str('http.request.method', known ? ev.method : '_OTHER')];
        if (!known) attributes.push(attr.str('http.request.method_original', ev.method));
        attributes.push(attr.str('url.full', redactUrl(ev.url)));
        try {
          const u = new URL(ev.url);
          attributes.push(attr.str('server.address', u.hostname));
          if (u.port) attributes.push(attr.int('server.port', Number(u.port)));
        } catch {
          /* relative URL: no server.address */
        }
        if (ev.status !== undefined) attributes.push(attr.int('http.response.status_code', ev.status));
        if (ev.error !== undefined) attributes.push(attr.str('error.type', '_OTHER'));
        else if (ev.status !== undefined && ev.status >= 400) attributes.push(attr.str('error.type', String(ev.status)));
        const fwd = workerKey(ev.worker);
        if (fwd) attributes.push(attr.str('atoll.worker', fwd));
        const span: OtlpSpan = {
          traceId: newTraceId(),
          spanId: newSpanId(),
          name: known ? ev.method : 'HTTP',
          kind: SPAN_KIND_CLIENT,
          startTimeUnixNano: toUnixNano(t - ev.ms),
          endTimeUnixNano: ns(),
          attributes,
        };
        if (ev.error !== undefined) span.status = { code: STATUS_ERROR, message: ev.error };
        else if (ev.status !== undefined && ev.status >= 400) span.status = { code: STATUS_ERROR };
        this.pushSpan(span);
        return;
      }
      case 'runtime:memory':
        if (this.metricsOn) {
          const a = this.threadAttrs(ev);
          this.m.heap.set(a, ev.heapBytes, ns());
          if (ev.rssBytes !== undefined) this.m.rss.set(a, ev.rssBytes, ns());
        }
        return;
      case 'runtime:longframe':
        if (this.metricsOn) {
          this.m.longFrames.add([], 1, ns());
          this.m.blocking.add([], ev.blockingMs, ns());
        }
        return;
      case 'runtime:frames':
        if (this.metricsOn) this.m.fps.set([], ev.fps, ns());
        return;
      case 'memory:write':
        if (this.metricsOn) this.m.writes.add([attr.str('atoll.memory.field', ev.path)], 1, ns());
        return;
      case 'worker:error': {
        const a = [attr.str('atoll.pool.id', ev.poolId), attr.int('atoll.worker.slot', ev.slot)];
        if (this.metricsOn) this.m.workerErrors.add([a[0]], 1, ns());
        this.log('error', `worker error: ${ev.message}`, [...a, ...this.threadAttrs(ev)], t, recvEpochMs);
        return;
      }
      case 'worker:respawn': {
        const a = [attr.str('atoll.pool.id', ev.poolId), attr.int('atoll.worker.slot', ev.slot)];
        if (this.metricsOn) this.m.respawns.add([a[0]], 1, ns());
        this.log('info', 'worker respawned', [...a, ...this.threadAttrs(ev)], t, recvEpochMs);
        return;
      }
      case 'log': {
        const a = [attr.str('atoll.log.scope', ev.scope), ...this.threadAttrs(ev)];
        if (ev.data !== undefined) a.push(attr.str('atoll.log.data', ev.data));
        this.log(ev.level, ev.message, a, t, recvEpochMs);
        return;
      }
      default:
        return;
    }
  }

  /** Remove up to `max` queued spans. */
  takeSpans(max: number): OtlpSpan[] {
    return this.spans.splice(0, max);
  }

  /** Remove up to `max` queued log records. */
  takeLogs(max: number): OtlpLogRecord[] {
    return this.logs.splice(0, max);
  }

  /** Cumulative snapshot of every metric with data; empty when metrics are off. */
  collectMetrics(nowEpochMs: number): OtlpMetric[] {
    if (!this.metricsOn) return [];
    const nowNs = toUnixNano(nowEpochMs);
    const inFlight = new Map<string, number>();
    for (const id of this.pools) inFlight.set(id, 0);
    for (const p of this.pending.values()) inFlight.set(p.poolId, (inFlight.get(p.poolId) ?? 0) + 1);
    for (const [id, n] of inFlight) this.m.inFlight.set([attr.str('atoll.pool.id', id)], n, nowNs);
    const out: OtlpMetric[] = [];
    for (const i of this.instruments) {
      const m = i.encode(nowNs);
      if (m) out.push(m);
    }
    return out;
  }
}

/* ── request bodies ──────────────────────────────────────────────────────── */

export const encodeTraces = (groups: { resource: KeyValue[]; spans: OtlpSpan[] }[]) => ({
  resourceSpans: groups.map((g) => ({
    resource: { attributes: g.resource },
    scopeSpans: [{ scope: OTEL_SCOPE, spans: g.spans }],
  })),
});

export const encodeMetrics = (groups: { resource: KeyValue[]; metrics: OtlpMetric[] }[]) => ({
  resourceMetrics: groups.map((g) => ({
    resource: { attributes: g.resource },
    scopeMetrics: [{ scope: OTEL_SCOPE, metrics: g.metrics }],
  })),
});

export const encodeLogs = (groups: { resource: KeyValue[]; logs: OtlpLogRecord[] }[]) => ({
  resourceLogs: groups.map((g) => ({
    resource: { attributes: g.resource },
    scopeLogs: [{ scope: OTEL_SCOPE, logRecords: g.logs }],
  })),
});
