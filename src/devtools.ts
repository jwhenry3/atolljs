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
      /** Per-worker in-flight cap; 0 for a dedicated worker (no queue, uncapped). */
      concurrency: number;
      memoryBytes?: number;
      /**
       * True for a single dedicated worker (`connectWorker({ workers: 1 })`,
       * island clients): no pool, no queue. Same event vocabulary otherwise.
       */
      dedicated?: boolean;
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
      /** Estimated structured-clone size of the task args (`estimateCloneBytes`). */
      argBytes?: number;
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
      /** Estimated structured-clone size of the result (`estimateCloneBytes`). */
      resultBytes?: number;
    }
  | {
      type: 'memory:bind';
      /** Version-counter index → field path, for pairing memory:write. */
      fields: [index: number, path: string][];
      totalBytes: number;
    }
  | { type: 'memory:write'; path: string; version: number }
  | {
      /** A dashboard-set watchpoint matched on write (`memory.watch` command). */
      type: 'memory:watch-hit';
      path: string;
      version: number;
      /** Preview of the written value (`previewValue`). */
      value: string;
      /** The watch rule as set, e.g. '> 100', 'change', '== "down"'. */
      rule: string;
    }
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
  | {
      type: 'island:event';
      instance: string;
      name: string;
      /** Preview of the emitted payload (`previewValue`). */
      payload?: string;
    }
  | {
      /** The props an island currently holds: sent on mount and every updateProps. */
      type: 'island:props';
      instance: string;
      /** Preview of the props object (`previewValue`); callbacks show as '[fn]'. */
      props: string;
    }
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
      /** Estimated structured-clone size of the op batch (`estimateCloneBytes`). */
      bytes?: number;
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
    }
  | {
      /**
       * A main-thread frame that blocked rendering: Long Animation Frame
       * entries where supported, `longtask` entries as the fallback.
       */
      type: 'runtime:longframe';
      /** Frame (or long task) duration. */
      ms: number;
      /** Time past the 50ms budget that blocked input/render. */
      blockingMs: number;
      /** LoAF script attribution, longest first (capped). */
      scripts?: { src?: string; fn?: string; ms: number }[];
      /**
       * Page was hidden: frame duration is throttling, not work, so only
       * frames with substantial script time are reported. Excluded from
       * foreground jank metrics.
       */
      hidden?: boolean;
    }
  | {
      /** Main-thread frame rate, sampled once a second via rAF while devtools is on. */
      type: 'runtime:frames';
      fps: number;
      /** Frames over ~2× the display interval in that second. */
      dropped: number;
    }
  | {
      /** A `src/log.ts` entry, mirrored into the stream (worker logs forward too). */
      type: 'log';
      level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
      scope: string;
      message: string;
      /** Preview of the structured data (`previewValue`). */
      data?: string;
    }
  | {
      /**
       * Cross-thread reactivity edge/node update for the dependency graph.
       * `id` names a reactive source or subscriber; `deps` are the ids it reads.
       */
      type: 'reactive:node';
      id: string;
      kind: 'source' | 'derived' | 'effect' | 'bridge';
      label?: string;
      deps?: string[];
      /** Thread-qualified owner, e.g. a pool id or island instance. */
      owner?: string;
      /** Set when the node is disposed. */
      disposed?: boolean;
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

/** The composed sink `emitDevtools` calls: null when nothing listens. */
let sink: DevtoolsSink | null = null;
/** The transport slot `setDevtoolsSink` owns. */
let primary: DevtoolsSink | null = null;
/** Additive listeners (`addDevtoolsSink`): exporters riding alongside the transport. */
const extraSinks = new Set<DevtoolsSink>();

const recompose = (): void => {
  if (extraSinks.size === 0) {
    sink = primary;
    return;
  }
  const all = primary ? [primary, ...extraSinks] : [...extraSinks];
  // Fan-out isolates listeners: one throwing sink can't starve the others.
  sink =
    all.length === 1
      ? all[0]
      : (event) => {
          for (const s of all) {
            try {
              s(event);
            } catch {
              /* a broken listener must not break the app or its siblings */
            }
          }
        };
};

/**
 * Install the transport sink (devtools transports hook here); null removes
 * it. Additive sinks (`addDevtoolsSink`) are unaffected.
 */
export const setDevtoolsSink = (custom: DevtoolsSink | null): void => {
  primary = custom;
  recompose();
};

/**
 * Add a listener alongside the transport sink (exporters like OTLP);
 * returns its remover. Any installed listener turns `devtoolsEnabled()` on,
 * so pools spawned afterwards enable worker forwarding the same way.
 */
export const addDevtoolsSink = (listener: DevtoolsSink): (() => void) => {
  extraSinks.add(listener);
  recompose();
  return () => {
    if (extraSinks.delete(listener)) recompose();
  };
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

/** True when a devtools sink (transport or additive listener) is installed on this thread. */
export const devtoolsEnabled = (): boolean => sink !== null;

/**
 * Compact, bounded preview of any value for event payloads: JSON-ish,
 * functions as '[fn]', typed arrays/buffers described by size, cycles cut,
 * capped at `max` chars. Call only behind `devtoolsEnabled()`.
 */
export const previewValue = (value: unknown, max = 2048): string => {
  const seen = new WeakSet<object>();
  let out: string;
  try {
    out =
      JSON.stringify(value, (_k, v: unknown) => {
        if (typeof v === 'function') return '[fn]';
        if (typeof v === 'bigint') return `${v}n`;
        if (v instanceof ArrayBuffer) return `[ArrayBuffer ${v.byteLength}B]`;
        if (ArrayBuffer.isView(v)) return `[${v.constructor.name} ${v.byteLength}B]`;
        if (v instanceof Map) return { '[Map]': [...v.entries()].slice(0, 50) };
        if (v instanceof Set) return { '[Set]': [...v].slice(0, 50) };
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[cycle]';
          seen.add(v);
        }
        return v;
      }) ?? String(value);
  } catch {
    out = String(value);
  }
  return out.length > max ? `${out.slice(0, max)}…` : out;
};

/**
 * Rough structured-clone size in bytes: strings 2B/char, numbers 8B,
 * typed arrays/buffers by byteLength, plus small per-key overhead. A cost
 * signal for the dashboard ("is this message big?"), not an exact count.
 * Walks at most `budget` nodes. Call only behind `devtoolsEnabled()`.
 */
export const estimateCloneBytes = (value: unknown, budget = 5000): number => {
  let nodes = 0;
  const seen = new WeakSet<object>();
  const walk = (v: unknown): number => {
    if (++nodes > budget) return 0;
    switch (typeof v) {
      case 'string': return 4 + v.length * 2;
      case 'number': return 8;
      case 'boolean': return 4;
      case 'bigint': return 16;
      case 'undefined': return 1;
      case 'object': {
        if (v === null) return 1;
        if (v instanceof ArrayBuffer) return v.byteLength;
        if (ArrayBuffer.isView(v)) return v.byteLength;
        if (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer) return 8;
        if (seen.has(v)) return 4;
        seen.add(v);
        let n = 8;
        if (v instanceof Map) for (const [k, x] of v) n += walk(k) + walk(x);
        else if (v instanceof Set) for (const x of v) n += walk(x);
        else if (Array.isArray(v)) for (const x of v) n += walk(x);
        else for (const k of Object.keys(v)) n += 4 + k.length * 2 + walk((v as Record<string, unknown>)[k]);
        return n;
      }
      default: return 0;
    }
  };
  return walk(value);
};

/* ── control: dashboard → app commands ───────────────────────────────────── */

/**
 * A command the dashboard can invoke on this app (`control` frames on the
 * devtools transport). Args and result must be structured-cloneable and
 * JSON-safe (the WebSocket path stringifies them).
 */
export type DevtoolsCommandHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

const commands = new Map<string, DevtoolsCommandHandler>();

/**
 * Register a dashboard-invocable command; returns an unregister function.
 * Names are dotted by area: 'island.tree', 'worker.kill', 'memory.read'.
 * A later registration under the same name replaces the earlier one.
 */
export const registerDevtoolsCommand = (name: string, handler: DevtoolsCommandHandler): (() => void) => {
  commands.set(name, handler);
  return () => {
    if (commands.get(name) === handler) commands.delete(name);
  };
};

/** Names of the registered commands — the dashboard enables controls from this. */
export const listDevtoolsCommands = (): string[] => [...commands.keys()].sort();

/** Run a registered command (transports call this for inbound `control` frames). */
export const runDevtoolsCommand = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  if (name === 'devtools.commands') return listDevtoolsCommands();
  const handler = commands.get(name);
  if (!handler) throw new Error(`unknown devtools command '${name}'`);
  return handler(args);
};

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
const named = new Map<string, number>();
/**
 * Process-unique ids for runners. Unnamed: 'pool-1', 'worker-2', … Named:
 * the slugged name plus a kind suffix, '-p' for a pool and '-w' for a
 * dedicated worker ('regions-p', 'ops-inline-w'); a repeated name gets a
 * counter ('regions-w', 'regions-w2'). Slugs never contain '#', '~' or
 * '|', which the dashboard uses to qualify forwarded ids.
 */
export const nextDevtoolsId = (prefix: string, name?: string): string => {
  const slug = name
    ?.toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return `${prefix}-${++seq}`;
  const base = `${slug}-${prefix === 'pool' ? 'p' : prefix === 'worker' ? 'w' : prefix}`;
  const n = (named.get(base) ?? 0) + 1;
  named.set(base, n);
  return n === 1 ? base : `${base}${n}`;
};
