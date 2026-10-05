/**
 * `@atolljs/devtools/otel` — ship atoll instrumentation to any OpenTelemetry
 * backend (Collector, Jaeger, Tempo, Honeycomb, Grafana) over OTLP/HTTP
 * with JSON encoding. Zero dependencies: `fetch` + the mapping in otelMap.ts.
 *
 *   import { exportOtel } from '@atolljs/devtools/otel';
 *   const otel = exportOtel({ serviceName: 'my-app' }); // → http://localhost:4318
 *
 * Installs as an additive devtools listener (`addDevtoolsSink`), so it runs
 * alongside `connectDevtools()` or alone. Call it before pools spawn: like
 * the dashboard transports, worker-side events forward only when a
 * listener existed at the worker's INIT handshake.
 */
import { addDevtoolsSink, installFetchProbe, installMemoryProbe } from '@atolljs/core';
import { OtelMapper, type OtelMapperOptions, type OtelSignals } from './otelMap';
import {
  createOtelPipeline,
  createOtlpSender,
  localResource,
  type OtlpSenderOptions,
  type ResourceAttributes,
} from './otelTransport';
import { installJankProbe } from './probes';

export interface ExportOtelOptions extends OtlpSenderOptions {
  /** Resource `service.name` (default 'unknown_service'). */
  serviceName?: string;
  /** Extra resource attributes, merged over the detected ones. */
  resource?: ResourceAttributes;
  /** Signals to export: all on by default. */
  signals?: OtelSignals;
  /** Periodic flush interval (default 5000ms). */
  flushIntervalMs?: number;
  /** Spans / log records per request (default 512). */
  maxBatch?: number;
  /** Queued spans and log records each before the oldest drop (default 2048). */
  maxQueue?: number;
  /** Series per metric before new attribute sets drop (default 2000). */
  maxSeries?: number;
  /** Patch global fetch for `net:fetch` spans (default true). */
  network?: boolean;
  /** Sample JS heap for `atoll.runtime.heap` (default true). */
  memory?: boolean;
  /** Browser main thread: long-frame / fps probe (default true). */
  jank?: boolean;
}

export interface OtelExporter {
  /** Ship everything queued now (plus a metrics snapshot). Never rejects. */
  flush(): Promise<void>;
  /** Uninstall the listener and lifecycle hooks, then flush. Never rejects. */
  close(): Promise<void>;
}

export function exportOtel(opts: ExportOtelOptions = {}): OtelExporter {
  // The sender captures the global fetch now, before the probe below wraps
  // it, so the exporter's own posts never become net:fetch spans.
  const sender = createOtlpSender(opts);
  const endpoint = sender.endpoint;
  const perf = globalThis.performance;
  const originMs = perf.timeOrigin ?? Date.now() - perf.now();
  const mapperOpts: OtelMapperOptions = {
    resource: localResource(opts.serviceName, opts.resource),
    originMs,
    signals: opts.signals,
    maxQueue: opts.maxQueue,
    maxSeries: opts.maxSeries,
    // An earlier probe (connectDevtools) may already wrap the captured fetch.
    ignoreUrl: (url) => url.startsWith(endpoint),
  };
  const pipeline = createOtelPipeline({
    sender,
    newMapper: () => new OtelMapper(mapperOpts),
    flushIntervalMs: opts.flushIntervalMs,
    maxBatch: opts.maxBatch,
    signals: opts.signals,
  });

  const remove = addDevtoolsSink((ev) => pipeline.ingest(ev, originMs + perf.now()));

  if (opts.network !== false) installFetchProbe(globalThis);
  if (opts.memory !== false) installMemoryProbe(globalThis);
  const releaseJank = opts.jank !== false ? installJankProbe() : () => {};

  // Last-chance flushes: keepalive fetch survives page unload (sendBeacon
  // can't carry auth headers or a JSON content-type cross-origin).
  type Listenable = {
    addEventListener?: (t: string, l: () => void) => void;
    removeEventListener?: (t: string, l: () => void) => void;
  };
  const g = globalThis as Listenable & {
    document?: Listenable & { visibilityState?: string };
    process?: {
      once?: (e: string, l: () => void) => void;
      off?: (e: string, l: () => void) => void;
      versions?: { node?: string };
    };
  };
  const onHide = () => {
    if (g.document?.visibilityState === 'hidden') void pipeline.flush({ keepalive: true });
  };
  const onPageHide = () => void pipeline.flush({ keepalive: true });
  const inBrowser = typeof g.document !== 'undefined' && typeof g.addEventListener === 'function';
  if (inBrowser) {
    g.addEventListener!('pagehide', onPageHide);
    g.document!.addEventListener?.('visibilitychange', onHide);
  }
  const onBeforeExit = () => void pipeline.flush();
  const inNode = !inBrowser && typeof g.process?.once === 'function' && g.process.versions?.node !== undefined;
  if (inNode) g.process!.once!('beforeExit', onBeforeExit);

  let closed = false;
  return {
    flush: () => pipeline.flush(),
    async close() {
      if (closed) return;
      closed = true;
      remove();
      releaseJank();
      if (inBrowser) {
        g.removeEventListener?.('pagehide', onPageHide);
        g.document?.removeEventListener?.('visibilitychange', onHide);
      }
      if (inNode) g.process!.off?.('beforeExit', onBeforeExit);
      await pipeline.close();
    },
  };
}

export { OtelMapper, SEVERITY, newSpanId, newTraceId, toUnixNano } from './otelMap';
export type { KeyValue, OtelMapperOptions, OtelSignals, OtlpLogRecord, OtlpMetric, OtlpSpan } from './otelMap';
export { createOtelPipeline, createOtlpSender, localResource, sessionResource } from './otelTransport';
export type {
  OtelPipeline,
  OtelPipelineOptions,
  OtlpSender,
  OtlpSenderOptions,
  OtlpSignal,
  ResourceAttributes,
} from './otelTransport';
