/**
 * Main-thread responsiveness probes, installed by the transports next to
 * `installMemoryProbe`:
 *
 * - `runtime:longframe`: Long Animation Frame entries (blocking time plus
 *   the longest scripts) where the engine supports them, `longtask`
 *   entries otherwise. While the page is hidden, only frames with at least
 *   `HIDDEN_SCRIPT_MS` of script are reported, flagged `hidden: true`.
 * - `runtime:frames`: a rAF sampler, one event per second with fps and the
 *   frames that took over ~2x the display interval.
 *
 * Browser main thread only: a no-op in Node and in workers. Idempotent and
 * reference-counted, so two connections share one observer + one rAF loop
 * and the loop stops when the last one closes.
 */
import { emitDevtools } from '@atolljs/core';

const MAX_SCRIPTS = 5;
/** Long tasks past this block input; LoAF reports `blockingDuration` directly. */
const BUDGET_MS = 50;
/** While hidden, a frame is reported only with at least this much script time. */
export const HIDDEN_SCRIPT_MS = 100;
/** A gap this long means the tab was hidden/throttled, not a dropped frame. */
const STALL_MS = 1000;

interface LoafScript {
  duration: number;
  sourceURL?: string;
  sourceFunctionName?: string;
  invoker?: string;
}
interface LoafEntry extends PerformanceEntry {
  blockingDuration?: number;
  scripts?: LoafScript[];
}

let refs = 0;
let teardown: (() => void) | null = null;

const isBrowserMain = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.document !== 'undefined' &&
  typeof requestAnimationFrame === 'function' &&
  !(typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope);

const observeLongFrames = (): (() => void) => {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  const type = supported.includes('long-animation-frame')
    ? 'long-animation-frame'
    : supported.includes('longtask')
      ? 'longtask'
      : null;
  if (!type) return () => {};
  const obs = new PerformanceObserver((list) => {
    const hidden = document.visibilityState === 'hidden';
    for (const e of list.getEntries() as LoafEntry[]) {
      const ms = Math.round(e.duration);
      const blockingMs = Math.round(e.blockingDuration ?? Math.max(0, e.duration - BUDGET_MS));
      // Throttled renders (background or occluded view) stretch frames with
      // no work in them, so judge by script time, not frame duration.
      const scriptMs = e.scripts ? e.scripts.reduce((n, s) => n + s.duration, 0) : undefined;
      if (hidden) {
        // longtask entries have no script attribution: their duration is the task itself.
        if ((scriptMs ?? e.duration) < HIDDEN_SCRIPT_MS) continue;
      } else if (e.blockingDuration === 0 && (scriptMs ?? 0) < BUDGET_MS) continue;
      const scripts = e.scripts?.length
        ? [...e.scripts]
            .sort((a, b) => b.duration - a.duration)
            .slice(0, MAX_SCRIPTS)
            .map((s) => ({
              src: s.sourceURL ? s.sourceURL.slice(0, 300) : undefined,
              fn: s.sourceFunctionName || s.invoker || undefined,
              ms: Math.round(s.duration),
            }))
        : undefined;
      emitDevtools({
        type: 'runtime:longframe', ms, blockingMs,
        ...(scripts ? { scripts } : {}),
        ...(hidden ? { hidden: true } : {}),
      });
    }
  });
  try {
    obs.observe({ type, buffered: true });
  } catch {
    return () => {};
  }
  return () => obs.disconnect();
};

const sampleFrames = (): (() => void) => {
  let raf = 0;
  let last = 0;
  let windowStart = 0;
  let frames = 0;
  let dropped = 0;
  /** Display interval estimate: the shortest frame seen (≥4ms), 60Hz until known. */
  let interval = 1000 / 60;
  let shortest = Infinity;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (!last) {
      last = windowStart = now;
      return;
    }
    const dt = now - last;
    last = now;
    if (dt > STALL_MS) {
      // hidden tab / debugger pause: restart the window, report nothing
      windowStart = now;
      frames = dropped = 0;
      return;
    }
    frames++;
    if (dt >= 4 && dt < shortest) shortest = dt;
    if (dt > interval * 2) dropped++;
    const elapsed = now - windowStart;
    if (elapsed >= 1000) {
      emitDevtools({ type: 'runtime:frames', fps: Math.round((frames * 1000) / elapsed), dropped });
      if (shortest !== Infinity) interval = shortest;
      shortest = Infinity;
      windowStart = now;
      frames = dropped = 0;
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
};

/**
 * Start the long-frame observer and the frame sampler; returns a release
 * function (the probes stop when every installer has released).
 */
export function installJankProbe(): () => void {
  if (!isBrowserMain()) return () => {};
  refs++;
  if (!teardown) {
    const stopObs = observeLongFrames();
    const stopRaf = sampleFrames();
    teardown = () => {
      stopObs();
      stopRaf();
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--refs === 0 && teardown) {
      teardown();
      teardown = null;
    }
  };
}
