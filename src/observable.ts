import type { Connector, PathConnector, SharedMemory, SharedSpec, SpecPath } from './contract/sharedMemory';
import { watch, type SliceOptions } from './reactive';
import { scoped } from './log';

const obsLog = scoped('observe');

/**
 * A minimal subscribable snapshot — `get()` plus `subscribe()`. This is the
 * interface every framework binding adapts (useSyncExternalStore, refs,
 * signals, runes). `get()` must return a stable value between notifications.
 */
export interface ObservableValue<T> {
  get(): T;
  subscribe(onChange: (value: T) => void): () => void;
}

type FieldValue<C> = C extends Connector<infer T> ? T : never;

/**
 * Observe one field of a shared memory contract as a subscribable snapshot.
 *
 * Safe to call before the contract is bound — `get()` returns `undefined`
 * until binding, and a subscriber registered early activates its watch when
 * `bind()` lands (useful for SSR, where renders happen without a buffer).
 * The underlying `watch` starts on the first subscriber and stops when the
 * last one leaves.
 */
export function observe<S extends SharedSpec, K extends SpecPath<S>>(
  memory: SharedMemory<S>,
  key: K
): ObservableValue<FieldValue<PathConnector<S, K>> | undefined>;
/**
 * Slice form: `observe(memory, 'metrics', m => m.critical)` — the observable
 * emits only when the selected slice changes. Slice equality defaults to
 * `Object.is`; pass `{ equals }` to define what counts as a change —
 * `shallowEqual` for object slices, or any `(prev, next) => boolean`.
 */
export function observe<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select: (value: FieldValue<PathConnector<S, K>>) => Sel,
  options?: SliceOptions<Sel>
): ObservableValue<Sel | undefined>;
export function observe<S extends SharedSpec, K extends SpecPath<S>, Sel>(
  memory: SharedMemory<S>,
  key: K,
  select?: (value: FieldValue<PathConnector<S, K>>) => Sel,
  options?: SliceOptions<Sel>
): ObservableValue<unknown> {
  type T = FieldValue<PathConnector<S, K>>;
  type Out = T | Sel;
  const selectFn = (select ?? ((v: T) => v)) as (value: T) => Out;
  const equals = (options?.equals ?? Object.is) as (a: Out, b: Out) => boolean;
  let current: Out | undefined;
  let lastVersion = -1;
  let unwatch: (() => void) | null = null;
  let pendingBind: (() => void) | null = null;
  let rebindUn: (() => void) | null = null;
  let watched: Connector<T> | null = null;
  const subscribers = new Set<(value: Out | undefined) => void>();

  const activate = () => {
    if (unwatch || pendingBind) return;
    let connector: Connector<T>;
    try {
      connector = memory.connector(String(key)) as Connector<T>;
    } catch {
      // Not bound on this thread yet — activate when it is.
      pendingBind = memory.onBound(() => {
        pendingBind = null;
        activate();
      });
      return;
    }
    unwatch = watch(
      connector,
      selectFn as (value: T) => Sel,
      (value) => {
        // Same gate as get(): get() may already have stored an equal-valued
        // snapshot — keep its reference and skip the emit.
        if (current === undefined || !equals(current as Out, value)) {
          current = value;
          for (const cb of subscribers) cb(value);
        }
      },
      options
    );
    watched = connector;
    // bind() can REBIND this contract to a different buffer — in-process
    // harnesses run every worker's bindSharedMemories in one module graph,
    // so a later pool's spawn rebinds this contract too. The watch above
    // pins the old connector (old buffer); re-watch when it swaps. onBound
    // fires synchronously when already bound — the identity check makes
    // that first call a no-op.
    rebindUn ??= memory.onBound(() => {
      let next: Connector<T>;
      try {
        next = memory.connector(String(key)) as Connector<T>;
      } catch {
        return;
      }
      if (next === watched) return;
      unwatch?.();
      unwatch = null;
      watched = null;
      activate();
    });
    obsLog.debug(`observing "${String(key)}" (offset ${connector.byteOffset})`);
  };

  const deactivate = () => {
    unwatch?.();
    unwatch = null;
    watched = null;
    pendingBind?.();
    pendingBind = null;
    rebindUn?.();
    rebindUn = null;
  };

  return {
    get() {
      // Re-read only when the shared version counter moved — decoding a
      // structured field on every snapshot check would be wasted work.
      if (unwatch || memory.bound) {
        try {
          const connector = memory.connector(String(key)) as Connector<T>;
          const version = connector._version ? Atomics.load(connector._version.view, connector._version.index) : 0;
          if (version !== lastVersion) {
            lastVersion = version;
            // Keep the snapshot reference stable between emissions — the
            // comparator decides what counts as a change here too.
            const next = selectFn(connector.read());
            if (current === undefined || !equals(current as Out, next)) current = next;
          }
        } catch {
          // Racing an unbind/rebind — keep the last known value.
        }
      }
      return current;
    },
    subscribe(onChange) {
      subscribers.add(onChange);
      activate();
      return () => {
        subscribers.delete(onChange);
        if (subscribers.size === 0) deactivate();
      };
    },
  };
}
