import { createEffect, createMemo, createRenderEffect, createRoot, createSignal } from 'solid-js';
import { Connector } from './contract/sharedMemory';
import { scoped } from './log';
import { disposeNodes, graphNode, graphSource } from './reactiveGraph';

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

/**
 * Park on the connector's shared version counter and invoke `onBump` on each
 * write — local or remote, both bump it. waitAsync when available, 50ms poll
 * otherwise. No solid-js involved: this is the whole remote-write mechanism.
 */
interface VersionWatch {
  stop: () => void;
  /** Devtools graph id of the bridge node (null while devtools is off). */
  node: string | null;
}

const watchVersionNode = <T>(connector: Connector<T>, onBump: () => void): VersionWatch => {
  const version = connector._version;
  if (!version) {
    throw new Error('This connector does not support remote observation.');
  }
  const waits = typeof Atomics.waitAsync === 'function';
  const node = graphNode('bridge', `${waits ? 'waitAsync' : 'poll'} ${connector._path ?? `@${connector.byteOffset}`}`, [
    graphSource(connector._path),
  ]);
  const stop = watchVersionRaw(connector, version, onBump);
  return {
    node,
    stop: () => {
      stop();
      disposeNodes(node);
    },
  };
};

const watchVersion = <T>(connector: Connector<T>, onBump: () => void): (() => void) =>
  watchVersionNode(connector, onBump).stop;

const watchVersionRaw = <T>(
  connector: Connector<T>,
  version: { view: Int32Array; index: number },
  onBump: () => void,
): (() => void) => {
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
          onBump();
        }
      }
      reactiveLog.debug(`stopped observing (offset ${connector.byteOffset})`);
    })();
    return () => { stopped = true; };
  }

  reactiveLog.warn(`Atomics.waitAsync unavailable — observing via 50ms poll (offset ${connector.byteOffset})`);
  const timer = setInterval(() => {
    const current = Atomics.load(version.view, version.index);
    if (current !== last) {
      last = current;
      onBump();
    }
  }, 50);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
};

/**
 * Under `node`/`worker`/`deno` export conditions, `solid-js` resolves to the
 * SSR build — `createEffect` is a no-op, so signal-driven `watch`/`observe`
 * die silently. Probe once. `createRenderEffect` is the discriminator: it
 * runs synchronously at creation in BOTH builds but only re-fires on `set`
 * in the client build. `createEffect` can't be used — the client build
 * defers it past the synchronous `set` below, probing a false negative.
 * The write must land AFTER the root's create pass returns for the same
 * reason (a set issued mid-subscription is swallowed).
 */
let solidLive: boolean | null = null;
const solidIsLive = (): boolean => {
  if (solidLive !== null) return solidLive;
  try {
    let runs = 0;
    let bump: ((v: number) => number) | undefined;
    createRoot(() => {
      const [get, set] = createSignal(0);
      bump = set;
      createRenderEffect(() => {
        get();
        runs++;
      });
    });
    bump?.(1);
    solidLive = runs > 1;
  } catch {
    solidLive = false;
  }
  if (!solidLive) {
    reactiveLog.warn('solid-js resolved to the SSR build — watch() falls back to direct version watching');
  }
  return solidLive;
};

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
    observeRemote: () => watchVersion(connector, bump),
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
  return watchNodes(connector, select, cb, options, { sliced: onChange !== undefined, label: 'watch' }).stop;
}

/** Graph labelling for {@link watchNodes} — `observe()` names its effect. */
export interface WatchMeta {
  /** A real selector was given (draws a derived node), not the identity. */
  sliced: boolean;
  /** Effect node label prefix: 'watch', 'observe'. */
  label: string;
}

/**
 * `watch()` plus its devtools graph wiring: bridge → [derived slice] →
 * effect. Internal: `observe()` uses it to own the effect node's label.
 */
export function watchNodes<T, S>(
  connector: Connector<T>,
  select: (value: T) => S,
  cb: (slice: S, previous: S | undefined) => void,
  options: SliceOptions<S> | undefined,
  meta: WatchMeta,
): { stop: () => void; effect: string | null } {
  const path = connector._path ?? `@${connector.byteOffset}`;
  // Nodes are created around the version watch below; ids are null while
  // devtools is off, and every graph call no-ops on null.
  let bridge: string | null = null;
  let derived: string | null = null;
  let effect: string | null = null;
  const graph = (): void => {
    derived = meta.sliced ? graphNode('derived', `select(${path})`, [bridge]) : null;
    effect = graphNode('effect', `${meta.label}(${path})`, [derived ?? bridge]);
  };
  const ungraph = (): void => disposeNodes(effect, derived);

  // SSR solid build (node/worker conditions): effects never re-run, so the
  // signal pipeline below would silently never emit. Same semantics, driven
  // straight off the version counter instead.
  if (!solidIsLive()) {
    const eq = (a: S | undefined, b: S | undefined): boolean =>
      a === undefined || b === undefined ? a === b : (options?.equals ?? Object.is)(a, b);
    let prev: S | undefined;
    const emit = () => {
      const v = connector.read() as T | null | undefined;
      const s = v == null ? undefined : select(v);
      if (s === undefined || eq(prev, s)) return;
      const old = prev;
      prev = s;
      cb(s, old);
    };
    emit();
    const remote = watchVersionNode(connector, emit);
    bridge = remote.node;
    graph();
    reactiveLog.debug(`watching connector at offset ${connector.byteOffset} (direct)`);
    return {
      effect,
      stop: () => {
        reactiveLog.debug(`watch stopped (offset ${connector.byteOffset})`);
        remote.stop();
        ungraph();
      },
    };
  }

  // reactive(connector) + observeRemote(), inlined to keep the bridge id.
  const [value, setValue] = createSignal<T>(connector.read(), { equals: false });
  const remote = watchVersionNode(connector, () => setValue(() => connector.read()));
  bridge = remote.node;
  graph();
  const dispose = createRoot((d) => {
    const slice = createMemo(
      () => {
        const v = value() as T | null | undefined;
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
  return {
    effect,
    stop: () => {
      reactiveLog.debug(`watch stopped (offset ${connector.byteOffset})`);
      remote.stop();
      dispose();
      ungraph();
    },
  };
}
