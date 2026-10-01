// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// vitest.config.ts aliases `solid-js` → dist/solid.js for every test, so the
// SSR build can't arrive via resolution here — stub its shapes explicitly.
// Without this, watch() gets a live runtime and the fallback goes untested.
vi.mock('solid-js', () => ({
  createSignal: (v: unknown) => [
    () => v,
    (n: unknown) => (v = typeof n === 'function' ? (n as (p: unknown) => unknown)(v) : n),
  ],
  createRoot: (fn: (dispose: () => void) => unknown) => fn(() => {}),
  createEffect: () => {},
  createRenderEffect: (fn: (v?: unknown) => unknown, v?: unknown) => {
    fn(v);
  },
  createMemo: (fn: (v?: unknown) => unknown, v?: unknown) => {
    const r = fn(v);
    return () => r;
  },
}));

import { watch } from './reactive';
import { SharedMemory, field, type SharedSpec, type FlatKey, type Connector } from './contract/sharedMemory';

/**
 * Under node resolve conditions `solid-js` resolves to its SSR build —
 * effects never re-run, so the signal pipeline can't emit. watch() must
 * still deliver via the version-counter fallback. (micro-mmo hit this in a
 * NestJS gateway: tasks + raw reads worked, observers silently never fired.)
 */

function boundConnector<S extends SharedSpec, K extends FlatKey<S>>(spec: S, key: K) {
  const mem = new SharedMemory(spec);
  mem.bind(new SharedArrayBuffer(mem.totalBytes));
  return mem.connector(key);
}

describe('watch under node conditions (SSR solid)', () => {
  it('emits on writes without solid scheduling', async () => {
    const conn = boundConnector({ n: field.number() }, 'n');
    const seen: number[] = [];
    const stop = watch(conn, (v) => seen.push(v));
    conn.write(7);
    await vi.waitFor(() => expect(seen).toContain(7));
    stop();
    conn.write(9);
    await new Promise((r) => setTimeout(r, 60));
    expect(seen).not.toContain(9);
  });

  it('fires once immediately with the current value', () => {
    const conn = boundConnector({ n: field.number() }, 'n');
    conn.write(3);
    const seen: number[] = [];
    const stop = watch(conn, (v) => seen.push(v));
    expect(seen).toEqual([3]);
    stop();
  });

  it('respects selector equality (options.equals)', async () => {
    const conn = boundConnector({ o: field.object({ maxBytes: 256 }) }, 'o') as Connector<{ a: number; b: number }>;
    conn.write({ a: 1, b: 2 });
    const seen: number[] = [];
    const stop = watch(conn, (v) => v.a, (s) => seen.push(s));
    conn.write({ a: 1, b: 99 }); // same slice → no emit
    conn.write({ a: 5, b: 99 });
    await vi.waitFor(() => expect(seen).toContain(5));
    expect(seen.filter((v) => v === 1)).toHaveLength(1);
    stop();
  });
});
