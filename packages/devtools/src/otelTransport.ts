/**
 * OTLP/HTTP JSON transport: a retrying `fetch` sender and the batching
 * pipeline that drains `OtelMapper`s into it. No @atolljs/core runtime
 * imports, so the aggregate server can forward without bundling the SDK.
 */
import type { EmittedDevtoolsEvent } from '@atolljs/core';
import {
  encodeLogs,
  encodeMetrics,
  encodeTraces,
  toAttributes,
  type KeyValue,
  type OtelMapper,
  type OtelSignals,
} from './otelMap';
import type { SessionInfo } from './protocol';

export type OtlpSignal = 'traces' | 'metrics' | 'logs';

export interface OtlpSenderOptions {
  /** OTLP/HTTP base URL; `/v1/<signal>` is appended (default http://localhost:4318). */
  endpoint?: string;
  /** Extra request headers (auth: `x-honeycomb-team`, `authorization`, …). */
  headers?: Record<string, string>;
  /** fetch implementation (default: the global fetch captured at creation). */
  fetch?: typeof fetch;
  /** Retries per request on 429/502/503/504 or network failure (default 3). */
  maxRetries?: number;
  /** Exponential backoff base when no Retry-After is sent (default 500ms). */
  retryBaseMs?: number;
  /** Cap on any single retry delay (default 30s). */
  retryMaxMs?: number;
  /**
   * Export failures (non-retryable status, retries exhausted). Never thrown
   * into app code. Don't route this through atoll's `log()`: that tees back
   * into the devtools stream and becomes the next export.
   */
  onError?: (error: Error, signal: OtlpSignal) => void;
}

export interface OtlpSender {
  readonly endpoint: string;
  /** POST one request body; resolves true when accepted. Never rejects. */
  send(signal: OtlpSignal, body: unknown, opts?: { keepalive?: boolean }): Promise<boolean>;
}

/** Retryable per the OTLP/HTTP spec; every other 4xx/5xx is final. */
const RETRYABLE = new Set([429, 502, 503, 504]);
/** fetch keepalive bodies share a 64KiB in-flight budget. */
const KEEPALIVE_MAX = 60_000;

const sleep = (ms: number) => new Promise<void>((r) => {
  const t = setTimeout(r, ms);
  (t as unknown as { unref?: () => void }).unref?.();
});

/** Retry-After: delta-seconds or an HTTP-date. */
const retryAfterMs = (h: string | null): number | undefined => {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
};

export const normalizeEndpoint = (endpoint = 'http://localhost:4318'): string => endpoint.replace(/\/+$/, '');

export function createOtlpSender(opts: OtlpSenderOptions = {}): OtlpSender {
  const endpoint = normalizeEndpoint(opts.endpoint);
  const doFetch = opts.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const maxRetries = opts.maxRetries ?? 3;
  const base = opts.retryBaseMs ?? 500;
  const cap = opts.retryMaxMs ?? 30_000;
  const fail = (signal: OtlpSignal, message: string) => {
    try {
      opts.onError?.(new Error(message), signal);
    } catch {
      /* a throwing callback must not escape */
    }
  };

  return {
    endpoint,
    async send(signal, body, sendOpts) {
      if (!doFetch) {
        fail(signal, 'otlp: no fetch available');
        return false;
      }
      const text = JSON.stringify(body);
      const keepalive = !!sendOpts?.keepalive && text.length < KEEPALIVE_MAX;
      for (let attempt = 0; ; attempt++) {
        let delay: number | undefined;
        let reason: string;
        try {
          const res = await doFetch(`${endpoint}/v1/${signal}`, {
            method: 'POST',
            headers: { ...opts.headers, 'content-type': 'application/json' },
            body: text,
            keepalive,
          });
          if (res.ok) return true;
          reason = `otlp ${signal}: HTTP ${res.status}`;
          if (!RETRYABLE.has(res.status)) {
            fail(signal, reason);
            return false;
          }
          delay = retryAfterMs(res.headers.get('retry-after'));
        } catch (err) {
          reason = `otlp ${signal}: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (attempt >= maxRetries) {
          fail(signal, `${reason} (gave up after ${attempt + 1} attempts)`);
          return false;
        }
        const backoff = base * 2 ** attempt;
        await sleep(Math.min(cap, delay ?? backoff * (0.5 + Math.random() / 2)));
      }
    },
  };
}

export interface OtelPipelineOptions {
  sender: OtlpSender;
  /** Builds the mapper for a key on first use ('' for a single-app exporter). */
  newMapper: (key: string) => OtelMapper;
  /** Periodic flush interval (default 5000ms). 0 disables the timer. */
  flushIntervalMs?: number;
  /** Spans / log records per request; reaching it triggers an early flush (default 512). */
  maxBatch?: number;
  signals?: OtelSignals;
  /** Epoch-ms clock for metric collection (default Date.now). */
  now?: () => number;
}

export interface OtelPipeline {
  ingest(ev: EmittedDevtoolsEvent, recvEpochMs: number, key?: string): void;
  /** Stop tracking a key after its queued data ships on the next flush. */
  release(key: string): void;
  /** Serialized: concurrent calls queue behind the in-flight flush. Never rejects. */
  flush(opts?: { keepalive?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export function createOtelPipeline(opts: OtelPipelineOptions): OtelPipeline {
  const { sender, newMapper } = opts;
  const maxBatch = Math.max(1, opts.maxBatch ?? 512);
  const now = opts.now ?? Date.now;
  const traces = opts.signals?.traces !== false;
  const metrics = opts.signals?.metrics !== false;
  const logs = opts.signals?.logs !== false;
  const mappers = new Map<string, OtelMapper>();
  const released = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let flushing = false;
  let closed = false;

  const sendQueued = async (signal: 'traces' | 'logs', keepalive: boolean): Promise<void> => {
    for (;;) {
      let budget = maxBatch;
      const groups: { resource: KeyValue[]; items: unknown[] }[] = [];
      for (const m of mappers.values()) {
        if (budget === 0) break;
        const items = signal === 'traces' ? m.takeSpans(budget) : m.takeLogs(budget);
        if (items.length) {
          groups.push({ resource: m.resource, items });
          budget -= items.length;
        }
      }
      if (groups.length === 0) return;
      const body =
        signal === 'traces'
          ? encodeTraces(groups.map((g) => ({ resource: g.resource, spans: g.items as never })))
          : encodeLogs(groups.map((g) => ({ resource: g.resource, logs: g.items as never })));
      await sender.send(signal, body, { keepalive });
    }
  };

  const doFlush = async (keepalive: boolean): Promise<void> => {
    flushing = true;
    try {
      if (traces) await sendQueued('traces', keepalive);
      if (logs) await sendQueued('logs', keepalive);
      if (metrics) {
        const t = now();
        const groups = [...mappers.values()]
          .map((m) => ({ resource: m.resource, metrics: m.collectMetrics(t) }))
          .filter((g) => g.metrics.length > 0);
        if (groups.length) await sender.send('metrics', encodeMetrics(groups), { keepalive });
      }
      for (const key of released) {
        const m = mappers.get(key);
        if (!m || (m.spans.length === 0 && m.logs.length === 0)) {
          mappers.delete(key);
          released.delete(key);
        }
      }
    } finally {
      flushing = false;
    }
  };

  const flush = (f?: { keepalive?: boolean }): Promise<void> => {
    chain = chain.then(() => doFlush(!!f?.keepalive)).catch(() => {});
    return chain;
  };

  const interval = opts.flushIntervalMs ?? 5000;
  const timer = interval > 0 ? setInterval(() => void flush(), interval) : undefined;
  (timer as unknown as { unref?: () => void } | undefined)?.unref?.();

  return {
    ingest(ev, recvEpochMs, key = '') {
      if (closed) return;
      let m = mappers.get(key);
      if (!m) {
        m = newMapper(key);
        mappers.set(key, m);
      }
      released.delete(key);
      m.ingest(ev, recvEpochMs);
      if (!flushing && (m.spans.length >= maxBatch || m.logs.length >= maxBatch)) void flush();
    },
    release(key) {
      if (mappers.has(key)) released.add(key);
    },
    flush,
    async close() {
      if (closed) return chain;
      closed = true;
      if (timer) clearInterval(timer);
      return flush();
    },
  };
}

/* ── resource ────────────────────────────────────────────────────────────── */

export type ResourceAttributes = Record<string, string | number | boolean | undefined>;

/** Resource attributes for this process: service.name, telemetry.sdk.*, runtime hints. */
export function localResource(serviceName?: string, extra: ResourceAttributes = {}): KeyValue[] {
  const g = globalThis as {
    window?: { document?: unknown };
    navigator?: { userAgent?: string };
    process?: { pid?: number; versions?: { node?: string } };
  };
  const browser = typeof g.window !== 'undefined' && typeof g.window.document !== 'undefined';
  const node = !browser && g.process?.versions?.node !== undefined;
  return toAttributes({
    'service.name': serviceName ?? 'unknown_service',
    'telemetry.sdk.name': 'atoll',
    'telemetry.sdk.language': node ? 'nodejs' : 'webjs',
    ...(node
      ? {
          'process.pid': g.process?.pid,
          'process.runtime.name': 'nodejs',
          'process.runtime.version': g.process?.versions?.node,
        }
      : { 'user_agent.original': g.navigator?.userAgent }),
    ...extra,
  });
}

/**
 * Resource attributes for a remote app session (aggregate-server
 * forwarding): the session name is the service unless a fixed one is given.
 */
export function sessionResource(
  session: SessionInfo,
  serviceName?: string,
  extra: ResourceAttributes = {},
): KeyValue[] {
  const node = session.runtime === 'node';
  return toAttributes({
    'service.name': serviceName ?? session.name ?? 'unknown_service',
    'service.instance.id': session.id,
    'telemetry.sdk.name': 'atoll',
    'telemetry.sdk.language': node ? 'nodejs' : 'webjs',
    ...(node
      ? { 'process.runtime.name': 'nodejs', 'process.runtime.version': session.env?.node?.replace(/^v/, '') }
      : { 'user_agent.original': session.env?.userAgent }),
    'atoll.session.hint': session.hint,
    'atoll.framework': session.framework,
    ...extra,
  });
}
