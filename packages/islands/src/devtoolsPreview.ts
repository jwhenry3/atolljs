/**
 * Devtools value helpers shared by both island drivers (main-thread
 * `island.ts`, worker-side `worker/subIsland.ts`). Call only behind
 * `devtoolsEnabled()`: everything here allocates.
 */
import { previewValue } from '@atolljs/core';
import { isCallbackMarker } from './callbackProps';

/** Node budget for one `jsonSafe` walk: props are small, a runaway graph isn't. */
const SAFE_BUDGET = 5000;

/**
 * JSON-safe deep copy of caller-given props: functions and `callbackProp`
 * markers become '[fn]', bigints `'<n>n'`, binary data a size label,
 * cycles '[cycle]'. The shape the dashboard can display and round-trip.
 */
export const jsonSafe = (value: unknown): unknown => {
  let nodes = 0;
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (++nodes > SAFE_BUDGET) return '[…]';
    if (typeof v === 'function' || isCallbackMarker(v)) return '[fn]';
    if (typeof v === 'bigint') return `${v}n`;
    if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
    if (typeof v !== 'object' || v === null) return v;
    if (v instanceof ArrayBuffer) return `[ArrayBuffer ${v.byteLength}B]`;
    if (ArrayBuffer.isView(v)) return `[${v.constructor.name} ${v.byteLength}B]`;
    if (v instanceof Date) return v.toISOString();
    if (seen.has(v)) return '[cycle]';
    if (depth > 12) return '[…]';
    seen.add(v);
    if (v instanceof Map) return { '[Map]': [...v.entries()].slice(0, 50).map((e) => walk(e, depth + 1)) };
    if (v instanceof Set) return { '[Set]': [...v].slice(0, 50).map((x) => walk(x, depth + 1)) };
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = walk(x, depth + 1);
    }
    return out;
  };
  return walk(value, 0);
};

/** `island:props` payload: a bounded preview with callbacks as '[fn]'. */
export const propsPreview = (props: Record<string, unknown>): string => previewValue(jsonSafe(props), 4096);
