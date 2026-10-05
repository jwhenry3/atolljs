/**
 * Dashboard commands over shared memory: `memory.read` (live values) and
 * watchpoints (`memory.watch` / `memory.unwatch` / `memory.watches`).
 * Registered by `SharedMemory.bind()` the first time a contract binds
 * while devtools is enabled, so apps without devtools never load them
 * into the command table.
 *
 * Watchpoints fire `memory:watch-hit` from two places on the thread that
 * set them (the main thread: commands arrive over its transport):
 * - the connector write path, synchronously, for writes made on this
 *   thread (guarded by `memoryWatches.size`, behind the existing
 *   `devtoolsEnabled()` check: zero cost with no watches);
 * - a version observer on each watched field, for writes from other
 *   threads (workers share the buffer, so the main thread reads their
 *   values). Remote bursts between two observations coalesce: only the
 *   latest value is checked.
 */
import { emitDevtools, previewValue, registerDevtoolsCommand } from '../devtools';
import type { Connector, SharedMemory } from './sharedMemory';

export type WatchRule = { text: string; test: (value: unknown) => boolean };

interface WatchState {
  rule: WatchRule;
  /** Per contract: last version checked and last value preview ('change'). */
  seen: WeakMap<SharedMemory<any>, { version: number; preview: string }>;
  stop: () => void;
  hits: number;
}

/** path → watch. Read by the write path — keep `.size` the only hot check. */
export const memoryWatches = new Map<string, WatchState>();

let contractsOf: () => readonly SharedMemory<any>[] = () => [];
let registered = false;

/* ── value previews ──────────────────────────────────────────────────────── */

const LIST_HEAD = 5;
const ARRAY_HEAD = 16;

/** Bounded preview of a field's current value — lists/typed arrays read only a head. */
export const fieldPreview = (connector: Connector<any>): string => {
  const list = connector as Connector<any> & { readAt?: (i: number) => unknown; recordCount?: number };
  if (typeof list.readAt === 'function' && typeof list.recordCount === 'number') {
    const head = Array.from({ length: Math.min(LIST_HEAD, list.recordCount) }, (_, i) => list.readAt!(i));
    return previewValue({ records: list.recordCount, head }, 1024);
  }
  const value = connector.read();
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const arr = value as unknown as ArrayLike<number | bigint>;
    const head = Array.from({ length: Math.min(ARRAY_HEAD, arr.length) }, (_, i) =>
      typeof arr[i] === 'bigint' ? `${arr[i]}n` : arr[i],
    );
    return `${value.constructor.name}(${arr.length}) ${JSON.stringify(head)}${arr.length > ARRAY_HEAD ? '…' : ''}`;
  }
  return previewValue(value, 1024);
};

/** Path lookup without the typed flat-key overload. */
const conn = (memory: SharedMemory<any>, path: string): Connector<any> =>
  (memory as unknown as { connector(p: string): Connector<any> }).connector(path);

const versionOf = (connector: Connector<any>): number =>
  connector._version ? Atomics.load(connector._version.view, connector._version.index) : 0;

/* ── rules ───────────────────────────────────────────────────────────────── */

const parseLiteral = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

const asNumber = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null;

/**
 * Parse a watch rule: 'change' | '> n' | '< n' | '>= n' | '<= n' | '== v' |
 * '!= v'. `v` is JSON when it parses ('"down"', 'true', '3'), else a bare
 * string. Numeric comparisons only match number/bigint fields.
 */
export const parseWatchRule = (raw: string): WatchRule => {
  const text = raw.trim();
  if (text === 'change') return { text, test: () => true };
  const m = /^(>=|<=|==|!=|>|<)\s*(.+)$/.exec(text);
  if (!m) throw new Error(`memory.watch: bad rule '${raw}' — use change, > n, < n, >= n, <= n, == v, != v`);
  const [, op, operand] = m;
  if (op === '==' || op === '!=') {
    const lit = parseLiteral(operand);
    const eq = (v: unknown) =>
      v !== null && typeof v === 'object' ? previewValue(v) === previewValue(lit) : Object.is(v, lit) || (typeof v === 'bigint' && Number(v) === lit);
    return { text, test: op === '==' ? eq : (v) => !eq(v) };
  }
  const n = Number(operand);
  if (!Number.isFinite(n)) throw new Error(`memory.watch: '${operand}' is not a number`);
  const cmp: Record<string, (a: number) => boolean> = {
    '>': (a) => a > n, '<': (a) => a < n, '>=': (a) => a >= n, '<=': (a) => a <= n,
  };
  return {
    text,
    test: (v) => {
      const a = asNumber(v);
      return a !== null && cmp[op](a);
    },
  };
};

/* ── matching ────────────────────────────────────────────────────────────── */

const check = (memory: SharedMemory<any>, path: string, w: WatchState, connector: Connector<any>, version: number): void => {
  const last = w.seen.get(memory);
  if (last && last.version >= version) return;
  const change = w.rule.text === 'change';
  // List fields only support 'change' — read() would decode every record.
  const isList = typeof (connector as { readAt?: unknown }).readAt === 'function';
  let value: unknown;
  let preview: string;
  try {
    preview = fieldPreview(connector);
    value = change || isList ? undefined : connector.read();
  } catch {
    return;
  }
  w.seen.set(memory, { version, preview });
  const hit = change ? preview !== last?.preview : !isList && w.rule.test(value);
  if (!hit) return;
  w.hits++;
  emitDevtools({ type: 'memory:watch-hit', path, version, value: preview, rule: w.rule.text });
};

/** Write-path hook — only called when `memoryWatches.size > 0`. */
export const checkWatchOnWrite = (memory: SharedMemory<any>, path: string, version: number): void => {
  const w = memoryWatches.get(path);
  if (!w) return;
  check(memory, path, w, conn(memory, path), version);
};

/**
 * Observe the field's version counter on this thread so other threads'
 * writes are checked too. Re-resolves the connector each wake (contracts
 * can rebind to another buffer) and waits with a timeout so a rebind is
 * picked up without a write. Falls back to a 50ms poll without waitAsync.
 */
const observeRemote = (path: string, w: WatchState): (() => void) => {
  let stopped = false;
  const sweep = (): void => {
    for (const memory of contractsOf()) {
      if (!memory.bound) continue;
      let connector: Connector<any>;
      try {
        connector = conn(memory, path);
      } catch {
        continue;
      }
      check(memory, path, w, connector, versionOf(connector));
    }
  };
  if (typeof Atomics.waitAsync === 'function') {
    void (async () => {
      while (!stopped) {
        const first = contractsOf().find((m) => {
          try {
            return m.bound && conn(m, path)._version !== undefined;
          } catch {
            return false;
          }
        });
        const slot = first ? conn(first, path)._version : undefined;
        if (slot) {
          const res = Atomics.waitAsync(slot.view, slot.index, Atomics.load(slot.view, slot.index), 250);
          if (res.async) await res.value;
        } else {
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!stopped) sweep();
      }
    })();
    return () => { stopped = true; };
  }
  const timer = setInterval(sweep, 50);
  (timer as unknown as { unref?: () => void }).unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
};

/* ── commands ────────────────────────────────────────────────────────────── */

const watchList = () =>
  [...memoryWatches.entries()].map(([path, w]) => ({ path, rule: w.rule.text, hits: w.hits }));

/** Register the `memory.*` commands once; `contracts` lists every defined contract. */
export const ensureMemoryCommands = (contracts: () => readonly SharedMemory<any>[]): void => {
  contractsOf = contracts;
  if (registered) return;
  registered = true;

  registerDevtoolsCommand('memory.read', () => {
    const out: { path: string; value: string; version: number; contract: number }[] = [];
    contractsOf().forEach((memory, contract) => {
      if (!memory.bound) return;
      for (const { path } of memory.fields()) {
        try {
          const connector = conn(memory, path);
          out.push({ path, value: fieldPreview(connector), version: versionOf(connector), contract });
        } catch (err) {
          out.push({ path, value: `[unreadable: ${(err as Error).message}]`, version: -1, contract });
        }
      }
    });
    return out;
  });

  registerDevtoolsCommand('memory.watch', (args) => {
    const path = String(args.path ?? '');
    if (!path) throw new Error('memory.watch: `path` is required');
    const known = contractsOf().some((m) => m.fields().some((f) => f.path === path));
    if (!known) throw new Error(`memory.watch: no contract defines a field '${path}'`);
    const rule = parseWatchRule(String(args.rule ?? 'change'));
    memoryWatches.get(path)?.stop();
    const w: WatchState = { rule, seen: new WeakMap(), stop: () => {}, hits: 0 };
    // Baseline: the current value/version is not a hit.
    for (const memory of contractsOf()) {
      if (!memory.bound) continue;
      try {
        const c = conn(memory, path);
        w.seen.set(memory, { version: versionOf(c), preview: fieldPreview(c) });
      } catch {
        /* contract without this field */
      }
    }
    memoryWatches.set(path, w);
    w.stop = observeRemote(path, w);
    return watchList();
  });

  registerDevtoolsCommand('memory.unwatch', (args) => {
    const path = String(args.path ?? '');
    memoryWatches.get(path)?.stop();
    memoryWatches.delete(path);
    return watchList();
  });

  registerDevtoolsCommand('memory.watches', () => watchList());
};
