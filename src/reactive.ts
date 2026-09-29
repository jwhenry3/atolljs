import { createEffect, createMemo, createRoot, createSignal } from 'solid-js';
import { Connector } from './contract/sharedMemory';
import { scoped } from './log';

const reactiveLog = scoped('reactive');

/** Emission control for slices — return `true` when `next` should be treated
 *  as unchanged (no emit). Defaults to `Object.is`. */
export type EqualityFn<T> = (prev: T, next: T) => boolean;

export interface SliceOptions<S> {
  /** Distinct comparator for the selected slice: `true` = unchanged. */
  equals?: EqualityFn<S>;
}

/** Reference-equality object comparator — emits when any own property value
 *  changes. Handy for object slices: `{ equals: shallowEqual }`. */
export function shallowEqual<T extends object>(prev: T | undefined, next: T | undefined): boolean {
  if (prev === next) return true;
  if (prev == null || next == null) return false;
  const a = Object.keys(prev) as (keyof T)[];
  const b = Object.keys(next) as (keyof T)[];
  return a.length === b.length && a.every((k) => Object.is(prev[k], next[k]));
}

/**
 * A reactive view over a shared memory connector. `get()` is signal-tracked,
 * so Solid effects and memos re-run when the field changes. `set()` writes
 * through the connector and notifies subscribers on this thread.
 */
export interface ReactiveConnector<T> {
  get(): T;
  set(value: T): void;
  peek(): T;
  /**
   * Start observing writes made by the other thread (via the shared version
   * counter). Returns a function to stop observing. Local writes already
   * notify through `set()`, so this is only needed for remote changes.
   */
  observeRemote(): () => void;
}

export function reactive<T>(connector: Connector<T>): ReactiveConnector<T> {
  const [value, setValue] = createSignal<T>(connector.read(), { equals: false });
  const bump = () => setValue(() => connector.read());

  return {
    get: value,
    peek: () => connector.read(),
    set: (v) => {
      connector.write(v);
      bump();
    },
    observeRemote: () => {
      const version = connector._version;
      if (!version) {
        throw new Error('This connector does not support remote observation.');
      }
      let stopped = false;
      let last = Atomics.load(version.view, version.index);

      if (typeof Atomics.waitAsync === 'function') {
        reactiveLog.debug(`observing remote writes (offset ${connector.byteOffset}, waitAsync)`);
        void (async () => {
          while (!stopped) {
            const result = Atomics.waitAsync(version.view, version.index, last);
            if (result.async) {
              await result.value;
            }
            last = Atomics.load(version.view, version.index);
            if (!stopped) {
              reactiveLog.trace(`remote write observed (offset ${connector.byteOffset})`);
              bump();
            }
          }
          reactiveLog.debug(`stopped observing (offset ${connector.byteOffset})`);
        })();
        return () => { stopped = true; };
      }

      // Fallback for environments without Atomics.waitAsync
      reactiveLog.warn(`Atomics.waitAsync unavailable — observing via 50ms poll (offset ${connector.byteOffset})`);
      const timer = setInterval(() => {
        const current = Atomics.load(version.view, version.index);
        if (current !== last) {
          last = current;
          bump();
        }
      }, 50);
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
  };
}

/**
 * Observe a shared-memory field and invoke `onChange` with its value on
 * every write — local or remote (both bump the shared version counter).
 * Fires once immediately with the current value unless the field has never
 * been written (structured fields read `undefined` until then).
 *
 * Pass a selector to watch a slice: `watch(conn, m => m.critical, cb)` —
 * the selected value is memoized, so the callback only runs when the slice
 * itself changes, not on every field write. Slice equality defaults to
 * `Object.is`; pass `options.equals` to decide what emits — e.g.
 * `{ equals: shallowEqual }` for object slices, or a custom comparator like
 * `(a, b) => Math.abs(a - b) < 0.01` to mute noise.
 *
 * Returns an unsubscribe function. Requires the contract to be bound on
 * this thread (the pool binds it on construction).
 */
export function watch<T>(connector: Connector<T>, onChange: (value: T) => void): () => void;
export function watch<T, S>(
  connector: Connector<T>,
  select: (value: T) => S,
  onChange: (slice: S, previous: S | undefined) => void,
  options?: SliceOptions<S>
): () => void;
export function watch<T, S = T>(
  connector: Connector<T>,
  selOrCb: ((value: T) => S) | ((slice: S, previous: S | undefined) => void),
  onChange?: (slice: S, previous: S | undefined) => void,
  options?: SliceOptions<S>
): () => void {
  const select = onChange ? (selOrCb as (value: T) => S) : ((v: T) => v as unknown as S);
  const cb = (onChange ?? selOrCb) as (slice: S, previous: S | undefined) => void;

  const sig = reactive(connector);
  const stopRemote = sig.observeRemote();
  const dispose = createRoot((d) => {
    const slice = createMemo(
      () => {
        const v = sig.get() as T | null | undefined;
        return v == null ? undefined : select(v);
      },
      undefined,
      options?.equals
        ? {
            // The memo starts at `undefined` — guard so user comparators only
            // ever see real slice values.
            equals: (a: S | undefined, b: S | undefined) =>
              a === undefined || b === undefined ? a === b : options.equals!(a, b),
          }
        : undefined
    );
    createEffect((prev: S | undefined) => {
      const s = slice();
      if (s !== undefined) cb(s, prev);
      return s;
    });
    return d;
  });
  reactiveLog.debug(`watching connector at offset ${connector.byteOffset}`);
  return () => {
    reactiveLog.debug(`watch stopped (offset ${connector.byteOffset})`);
    stopRemote();
    dispose();
  };
}
