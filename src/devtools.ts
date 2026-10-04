/**
 * Structured instrumentation events for the devtools/dashboard tooling.
 * Same zero-cost contract as `log.ts` and islands' `proxyMetrics`: when no
 * sink is installed, emit() is a single branch — production pays nothing.
 *
 * Events are emitted on whichever thread they occur on. Worker-side events
 * reach the main thread's sink by postMessage forwarding (`ATOLL_DEVTOOLS`
 * on the task channel — the pool re-emits them), so one sink sees the whole
 * app. See docs/plans/devtools-dashboard.md.
 */

export type DevtoolsThread = 'main' | 'worker';

export type TaskSettleOutcome =
  | 'ok'
  | 'error'
  | 'aborted'
  | 'timeout'
  | 'queue-full'
  | 'crashed';

export type DevtoolsEvent =
  | {
      type: 'pool:init';
      poolId: string;
      /** Config `name`, when supplied — a display label, not the id. */
      label?: string;
      poolSize: number;
      concurrency: number;
      memoryBytes?: number;
    }
  | { type: 'pool:terminate'; poolId: string }
  | { type: 'worker:spawn'; poolId: string; slot: number }
  | { type: 'worker:error'; poolId: string; slot: number; message: string }
  | { type: 'worker:respawn'; poolId: string; slot: number }
  | { type: 'task:enqueue'; poolId: string; callId: number; taskId: string }
  | {
      type: 'task:dispatch';
      poolId: string;
      callId: number;
      taskId: string;
      slot: number;
      waitMs: number;
    }
  | {
      type: 'task:settle';
      poolId: string;
      callId: number;
      taskId: string;
      outcome: TaskSettleOutcome;
      /** dispatch→reply; absent for calls that never ran. */
      runMs?: number;
      error?: string;
    }
  | {
      type: 'memory:bind';
      /** Version-counter index → field path, for pairing memory:write. */
      fields: [index: number, path: string][];
      totalBytes: number;
    }
  | { type: 'memory:write'; path: string; version: number }
  | {
      type: 'island:mount';
      instance: string;
      app: string;
      pid: string;
      /** The client pool driving this island — links the island to its worker. */
      poolId?: string;
      /** Renderer/framework tag supplied by the mounter — observability only. */
      framework?: string;
    }
  | { type: 'island:unmount'; instance: string }
  | { type: 'island:event'; instance: string; name: string }
  | {
      type: 'island:task';
      instance: string;
      /** The client call behind the round-trip — the island's "request". */
      method: 'mount' | 'whoami' | 'dispatch' | 'setSize' | 'updateProps' | 'flush' | 'unmount';
      /** Round-trip ms: call → ops returned (worker render + transport). */
      ms: number;
      /** Op count in the returned batch (response size in ops). */
      ops?: number;
      error?: string;
    }
  | {
      type: 'island:ops';
      instance: string;
      /** The client call that produced the batch. */
      via: 'mount' | 'updateProps' | 'dispatch' | 'setSize' | 'flush' | 'unmount';
      count: number;
      /** Main-thread replay time; worker-side render time rides call timings. */
      replayMs?: number;
    }
  | {
      type: 'net:fetch';
      /** Per-context sequence — correlates the net:fetch-detail follow-up. */
      id: number;
      url: string;
      method: string;
      /** HTTP status — absent when the request failed before a response. */
      status?: number;
      /** Time from dispatch to response headers (error: to failure). */
      ms: number;
      /** Response Content-Length when advertised. */
      bytes?: number;
      error?: string;
      reqHeaders?: [string, string][];
      /** Capped preview; non-text bodies are described, not dumped. */
      reqBody?: string;
    }
  | {
      /**
       * Detail follow-up to net:fetch (same id) — emitted after the response
       * settles so it can carry headers, a capped body preview, and the
       * Resource Timing stage breakdown once the entry exists.
       */
      type: 'net:fetch-detail';
      id: number;
      /** Present when the body was only readable async (Request objects). */
      reqBody?: string;
      resHeaders?: [string, string][];
      resBody?: string;
      /**
       * Stage ms from PerformanceResourceTiming: queue (stalled → fetch
       * start), dns, tcp, tls, wait (request → first byte), download.
       * Absent for cross-origin responses without Timing-Allow-Origin.
       */
      timing?: { queue: number; dns: number; tcp: number; tls: number; wait: number; download: number };
      transferSize?: number;
      encodedSize?: number;
      decodedSize?: number;
    }
  | {
      type: 'runtime:memory';
      /**
       * measureUserAgentSpecificMemory: cluster total.
       * performance.memory / process.memoryUsage fallback: this context's
       * usedJSHeapSize / heapUsed.
       */
      heapBytes: number;
      heapLimitBytes?: number;
      /** Resident set size — present on the Node memoryUsage() path. */
      rssBytes?: number;
      /**
       * Per-execution-context attribution from
       * `performance.measureUserAgentSpecificMemory` — emitted on the main
       * thread only (workers can't self-identify among same-URL contexts).
       * Worker contexts are identified by their script URL.
       */
      contexts?: { bytes: number; scope?: string; url?: string }[];
    };

export type EmittedDevtoolsEvent = DevtoolsEvent & {
  /** performance.now() on the emitting thread. */
  at: number;
  /** Which side of the boundary emitted the event. */
  thread: DevtoolsThread;
  /**
   * Stamped by the pool when re-emitting a worker-forwarded event —
   * attributes worker-side events (memory writes, fetches, heap samples)
   * to the specific pool slot that produced them.
   */
  worker?: { poolId: string; slot: number };
};

export type DevtoolsSink = (event: EmittedDevtoolsEvent) => void;

const THREAD: DevtoolsThread =
  typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope
    ? 'worker'
    : 'main';

let sink: DevtoolsSink | null = null;

/** Install the event sink (devtools transports hook here); null disables. */
export const setDevtoolsSink = (custom: DevtoolsSink | null): void => {
  sink = custom;
};

/** Emit a structured event — one branch when no sink is installed. */
export const emitDevtools = (event: DevtoolsEvent): void => {
  if (sink) sink({ ...event, at: performance.now(), thread: THREAD });
};

/**
 * Re-emit an already-stamped event — for forwarding worker-side events that
 * arrived over postMessage without re-stamping their timing/thread.
 */
export const forwardDevtools = (event: EmittedDevtoolsEvent): void => {
  if (sink) sink(event);
};

/** True when a devtools sink is installed on this thread. */
export const devtoolsEnabled = (): boolean => sink !== null;

let workerForwarding = false;

/**
 * Worker side: route emitted events to the main thread over the task
 * channel (`ATOLL_DEVTOOLS` messages — the pool re-emits them into its
 * sink). Switched on by the pool's INIT handshake when the pool has a
 * sink installed, so workers only forward when someone is listening.
 */
export const enableWorkerDevtoolsForwarding = (): void => {
  if (workerForwarding || typeof self === 'undefined') return;
  workerForwarding = true;
  setDevtoolsSink((event) => {
    (self as unknown as Worker).postMessage({ type: 'ATOLL_DEVTOOLS', event });
  });
  installFetchProbe(self);
  installMemoryProbe(self);
};

const PROBED = Symbol.for('atoll.devtools.fetch');

/** Body previews are capped — enough to inspect payloads, not to mirror them. */
const BODY_PREVIEW = 8 * 1024;
const TEXTISH = /text|json|javascript|xml|html|css|svg|csv|urlencoded|graphql/;

const headerList = (h?: Headers): [string, string][] | undefined =>
  h ? [...h.entries()].slice(0, 64) : undefined;

/** Best-effort request body preview — only trivially-readable bodies. */
const bodyPreview = (body: BodyInit | null | undefined): string | undefined => {
  if (body === null || body === undefined) return undefined;
  if (typeof body === 'string') return body.slice(0, BODY_PREVIEW);
  if (body instanceof URLSearchParams) return String(body).slice(0, BODY_PREVIEW);
  if (body instanceof Blob) return `[${body.type || 'blob'} ${body.size}B]`;
  if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength}B]`;
  if (ArrayBuffer.isView(body)) return `[${body.constructor.name} ${body.byteLength}B]`;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return '[FormData]';
  return '[stream]';
};

/** Read up to `cap` bytes of a clone — leaves the app's response untouched. */
const readPreview = async (res: Response, cap: number): Promise<string | undefined> => {
  const reader = res.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    while (n < cap) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      n += value.byteLength;
    }
  } catch {
    /* aborted stream — keep what we have */
  }
  if (!n) return undefined;
  const all = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all) + (n >= cap ? '…' : '');
};

interface FetchTiming {
  queue: number;
  dns: number;
  tcp: number;
  tls: number;
  wait: number;
  download: number;
}

interface TimingEntry extends FetchTiming {
  transferSize: number;
  encodedSize: number;
  decodedSize: number;
}

/**
 * Poll the resource-timing buffer for this request's entry — it only appears
 * once the body fully arrives, so it can lag well past headers. Cross-origin
 * entries without Timing-Allow-Origin surface with zeroed stages.
 */
const findTiming = async (absUrl: string, t0: number): Promise<TimingEntry | undefined> => {
  const perf = globalThis.performance as Performance | undefined;
  if (!perf?.getEntriesByType) return undefined;
  for (let tries = 0; tries < 12; tries++) {
    let best: PerformanceResourceTiming | undefined;
    for (const e of perf.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      if (e.name !== absUrl || e.startTime < t0 - 5) continue;
      if (!best || e.startTime < best.startTime) best = e;
    }
    if (best) {
      const seg = (a: number, b: number) => (b > a && a > 0 ? b - a : 0);
      return {
        queue: seg(best.fetchStart, best.domainLookupStart),
        dns: seg(best.domainLookupStart, best.domainLookupEnd),
        tcp:
          best.secureConnectionStart > 0
            ? seg(best.connectStart, best.secureConnectionStart)
            : seg(best.connectStart, best.connectEnd),
        tls: best.secureConnectionStart > 0 ? seg(best.secureConnectionStart, best.connectEnd) : 0,
        wait: seg(best.requestStart, best.responseStart),
        download: seg(best.responseStart, best.responseEnd),
        transferSize: best.transferSize,
        encodedSize: best.encodedBodySize,
        decodedSize: best.decodedBodySize,
      };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
};

/**
 * Wrap `scope.fetch` to emit `net:fetch` (+ a `net:fetch-detail` follow-up
 * with headers/body previews and stage timings) for every request — covers
 * main thread (installed by connectDevtools) and workers (installed by the
 * INIT handshake's forwarding flag). Idempotent; restores nothing (the
 * wrapper delegates to the captured original). XHR is not covered.
 */
export const installFetchProbe = (scope: { fetch?: typeof fetch }): void => {
  const original = scope.fetch;
  if (!original || (original as unknown as Record<symbol, true>)[PROBED]) return;
  let seq = 0;
  const wrapped: typeof fetch = async (input, init) => {
    const t0 = performance.now();
    const id = ++seq;
    const isReq = typeof Request !== 'undefined' && input instanceof Request;
    const url = isReq ? input.url : String(input);
    const abs = (() => {
      try {
        return new URL(url, self.location?.href).href;
      } catch {
        return url;
      }
    })();
    const method = (init?.method ?? (isReq ? input.method : 'GET')).toUpperCase();
    // Clone before the app's body consumption so previews stay readable.
    const reqClone = isReq && !init?.body ? input.clone() : null;
    const reqHeaders = headerList(
      init?.headers ? new Headers(init.headers) : isReq ? input.headers : undefined,
    );
    let reqBody = bodyPreview(init?.body);
    try {
      const res = await original.call(scope, input as RequestInfo | URL, init);
      const len = res.headers.get('content-length');
      emitDevtools({
        type: 'net:fetch',
        id,
        url: url.slice(0, 300),
        method,
        status: res.status,
        ms: performance.now() - t0,
        bytes: len === null ? undefined : Number(len),
        reqHeaders,
        reqBody,
      });
      // Detail rides a follow-up event — timing entries land after the body
      // does, and the caller gets `res` back without waiting on our preview.
      const resClone = res.clone();
      void (async () => {
        reqBody ??= reqClone ? await reqClone.text().then((t) => t.slice(0, BODY_PREVIEW)).catch(() => undefined) : undefined;
        const ct = res.headers.get('content-type') ?? '';
        const resBody = TEXTISH.test(ct) ? await readPreview(resClone, BODY_PREVIEW).catch(() => undefined) : undefined;
        const t = await findTiming(abs, t0);
        emitDevtools({
          type: 'net:fetch-detail',
          id,
          reqBody,
          resHeaders: headerList(res.headers),
          resBody,
          timing: t,
          transferSize: t?.transferSize,
          encodedSize: t?.encodedSize,
          decodedSize: t?.decodedSize,
        });
      })();
      return res;
    } catch (err) {
      emitDevtools({
        type: 'net:fetch',
        id,
        url: url.slice(0, 300),
        method,
        ms: performance.now() - t0,
        error: err instanceof Error ? err.message : String(err),
        reqHeaders,
        reqBody,
      });
      throw err;
    }
  };
  (wrapped as unknown as Record<symbol, true>)[PROBED] = true;
  scope.fetch = wrapped;
};

const memProbed = new WeakSet<object>();

interface MemoryBreakdown {
  bytes: number;
  attribution?: { url?: string; scope?: string }[];
}
interface MeasureMemoryResult {
  bytes: number;
  breakdown?: MemoryBreakdown[];
}

/**
 * Emit `runtime:memory` periodically — JS heap usage. On the main thread,
 * prefers `performance.measureUserAgentSpecificMemory()`, which reports a
 * per-execution-context breakdown (windows + workers identified by script
 * URL) for the whole agent cluster; falls back to `performance.memory`,
 * which also covers the worker-side install on engines that expose it
 * there, then `process.memoryUsage()` on Node (heapUsed + rss — works
 * inside worker_threads too). No-ops with none of the three.
 */
export const installMemoryProbe = (scope: object, intervalMs = 2500): void => {
  if (memProbed.has(scope)) return;
  const perf = (scope as { performance?: Performance }).performance;
  if (!perf) return;
  const mem = (perf as {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  const inWorker =
    typeof WorkerGlobalScope !== 'undefined' &&
    (globalThis as { self?: unknown }).self instanceof WorkerGlobalScope;
  const measure = (
    perf as { measureUserAgentSpecificMemory?: () => Promise<MeasureMemoryResult> }
  ).measureUserAgentSpecificMemory?.bind(perf);
  // Node fallback — process.memoryUsage() exists on the main thread and
  // inside worker_threads, so per-worker heap columns fill there too.
  const procMem = (
    globalThis as {
      process?: { memoryUsage?: () => { heapUsed: number; rss: number } };
    }
  ).process?.memoryUsage;
  // Workers skip the breakdown path: contexts sharing a script URL can't
  // be told apart, so a worker can't pick its own entry reliably.
  if (!mem && (!measure || inWorker) && !procMem) return;
  memProbed.add(scope);

  if (measure && !inWorker) {
    const timer = setInterval(() => {
      measure()
        .then((res) => {
          const contexts = (res.breakdown ?? [])
            .map((b) => ({
              bytes: b.bytes,
              scope: b.attribution?.[0]?.scope,
              url: b.attribution?.[0]?.url,
            }))
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, 24);
          emitDevtools({
            type: 'runtime:memory',
            heapBytes: res.bytes,
            heapLimitBytes: mem?.jsHeapSizeLimit,
            contexts,
          });
        })
        .catch(() => {
          if (mem) {
            emitDevtools({
              type: 'runtime:memory',
              heapBytes: mem.usedJSHeapSize,
              heapLimitBytes: mem.jsHeapSizeLimit,
            });
          }
        });
    }, Math.max(intervalMs, 4000)); // the measurement itself may GC — keep it slower
    (timer as unknown as { unref?: () => void }).unref?.();
    return;
  }

  const timer = setInterval(() => {
    if (mem) {
      emitDevtools({
        type: 'runtime:memory',
        heapBytes: mem.usedJSHeapSize,
        heapLimitBytes: mem.jsHeapSizeLimit,
      });
    } else if (procMem) {
      const u = procMem();
      emitDevtools({ type: 'runtime:memory', heapBytes: u.heapUsed, rssBytes: u.rss });
    }
  }, intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
};

let seq = 0;
/** Process-unique ids for pools — 'pool-1', 'pool-2', … */
export const nextDevtoolsId = (prefix: string): string => `${prefix}-${++seq}`;
