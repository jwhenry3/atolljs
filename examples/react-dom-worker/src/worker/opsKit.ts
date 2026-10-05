/**
 * Shared worker-side helpers for the ops console (console.worker.tsx and
 * region.worker.tsx). Both PolyWorker definitions import this module, so it
 * is a shared DEPENDENCY: each definition's bundle carries a copy, and each
 * spawned worker evaluates its own — no state here is shared across threads.
 */
import { useEffect, useRef, useState } from 'react';
import { bumpOpsVersion, runInInstance, type EventPayload } from '@atolljs/islands/worker';

export const handler = <E,>(fn: (e: EventPayload) => void): ((e: E) => void) =>
  fn as unknown as (e: E) => void;

/** Workers inherit the page's isolation, so this matches the shell's check. */
export const isolated =
  typeof SharedArrayBuffer !== 'undefined' &&
  (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated !== false;

export const TICK_MS = 250;

/**
 * A worker-thread heartbeat: a `setInterval` tick that measures how late
 * each tick fires. The worst lateness is the longest time this worker's
 * thread was blocked, which is exactly what a sibling instance's
 * synchronous task costs everything that shares the thread.
 */
export function useHeartbeat(): { beats: number; worstStall: number; reset: () => void } {
  const [beats, setBeats] = useState(0);
  const [worstStall, setWorstStall] = useState(0);
  const last = useRef(performance.now());
  useEffect(() => {
    last.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const late = Math.max(0, now - last.current - TICK_MS);
      last.current = now;
      setBeats((b) => b + 1);
      if (late > 50) setWorstStall((w) => Math.max(w, Math.round(late)));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);
  return { beats, worstStall, reset: () => setWorstStall(0) };
}

export { aggregate, type AggregateResult } from './opsCompute';

/**
 * Re-enter an island instance from a promise continuation (a compute
 * worker's reply lands outside any dispatch task): emits and state
 * updates route to `instance`, then the doorbell rings so the driver
 * flushes the queued ops.
 */
export const reenter = (instance: string, fn: () => void): void =>
  runInInstance(instance, () => {
    fn();
    bumpOpsVersion();
  });
