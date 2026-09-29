/**
 * Internal bookkeeping for measuring the island engine's own cost, separate
 * from application/render work. Disabled by default — the flag check is one
 * predictable branch per chokepoint, so production mounts pay nothing.
 *
 * The one subtlety is re-entrancy: a proxy-DOM method like `el.appendChild`
 * calls `pushOp`, which is itself instrumented. Timing every frame would
 * double-count, so `enter`/`exit` share a depth counter — only the
 * outermost instrumented frame accumulates. The residual
 * (`workerMs − recordMs`) is then application/adapter time.
 *
 * The bench spec additionally calls {@link instrumentPrototype} on the
 * worker-side dom/* classes so imperative-app shadow-tree maintenance is
 * captured too; framework adapters reach the same sinks directly.
 */
export const proxyMetrics = {
  enabled: false,
  /** Frames currently inside instrumented proxy code (re-entrancy guard). */
  depth: 0,
  /** ms inside outermost instrumented frames since reset(). */
  recordMs: 0,
  /** Ops pushed since reset() — a count, free to keep. */
  opsPushed: 0,
  reset(): void {
    this.depth = 0;
    this.recordMs = 0;
    this.opsPushed = 0;
  },
};

/**
 * Enter an instrumented frame — returns a start timestamp for the outermost
 * frame, or -1 when nested (in which case exit records nothing).
 */
export const enterProxyFrame = (): number => {
  proxyMetrics.depth++;
  return proxyMetrics.depth === 1 ? performance.now() : -1;
};

/** Pair with {@link enterProxyFrame} — accumulates only for t0 >= 0. */
export const exitProxyFrame = (t0: number): void => {
  proxyMetrics.depth--;
  if (t0 >= 0) proxyMetrics.recordMs += performance.now() - t0;
};

/**
 * Timing wrapper for a function — no-ops to a direct call while metrics are
 * disabled. Used to wrap dom/* prototype methods from the bench.
 */
const wrapTimed = <A extends unknown[], R>(fn: (...args: A) => R) =>
  function (this: unknown, ...args: A): R {
    if (!proxyMetrics.enabled) return fn.apply(this, args);
    const t0 = enterProxyFrame();
    try {
      return fn.apply(this, args);
    } finally {
      exitProxyFrame(t0);
    }
  };

/**
 * Wrap every method/getter/setter on a class prototype with timing. Live
 * for the rest of the process — intended for benchmark instrumentation,
 * not production.
 */
export function instrumentPrototype(proto: object): void {
  for (const [name, desc] of Object.entries(
    Object.getOwnPropertyDescriptors(proto),
  )) {
    if (name === 'constructor') continue;
    const wrapped: PropertyDescriptor = { ...desc };
    if (typeof desc.value === 'function') {
      wrapped.value = wrapTimed(desc.value as (...args: unknown[]) => unknown);
    }
    if (desc.get) wrapped.get = wrapTimed(desc.get);
    if (desc.set) wrapped.set = wrapTimed(desc.set);
    Object.defineProperty(proto, name, wrapped);
  }
}
