// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createEffect, createRoot } from 'solid-js';
import { reactive, shallowEqual, watch } from './reactive';
import { Connector, SharedMemory, SharedSpec, field } from './contract/sharedMemory';

function boundConnector<S extends SharedSpec, K extends keyof S>(spec: S, key: K, buffer?: SharedArrayBuffer) {
  const mem = new SharedMemory(spec);
  mem.bind(buffer ?? new SharedArrayBuffer(mem.totalBytes));
  return mem.connector(key);
}

describe('reactive connector', () => {
  it('reads via get() and writes via set()', () => {
    const rc = reactive(boundConnector({ n: field.number() }, 'n'));
    expect(rc.get()).toBe(0);
    rc.set(10);
    expect(rc.get()).toBe(10);
    expect(rc.peek()).toBe(10);
  });

  it('notifies effects on set()', async () => {
    const rc = reactive(boundConnector({ n: field.number() }, 'n'));
    const seen: number[] = [];
    const dispose = createRoot((d) => {
      createEffect(() => seen.push(rc.get()));
      return d;
    });
    // createEffect runs deferred; subsequent re-runs are synchronous
    await new Promise((r) => setTimeout(r, 0));
    rc.set(4);
    rc.set(9);
    expect(seen).toEqual([0, 4, 9]);
    dispose();
  });

  it('observes writes made by another binding (remote thread)', async () => {
    const spec = { n: field.number() };
    const local = new SharedMemory(spec);
    const remote = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(local.totalBytes);
    local.bind(buffer);
    remote.bind(buffer);

    const rc = reactive(local.connector('n'));
    const stop = rc.observeRemote();
    remote.connector('n').write(42);

    await vi.waitFor(() => expect(rc.get()).toBe(42), { timeout: 2000 });
    stop();
  });

  it('reflects remote object writes', async () => {
    const spec = { o: field.object<{ v: number }>(128) };
    const local = new SharedMemory(spec);
    const remote = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(local.totalBytes);
    local.bind(buffer);
    remote.bind(buffer);

    const rc = reactive(local.connector('o'));
    expect(rc.get()).toBeUndefined();
    const stop = rc.observeRemote();
    remote.connector('o').write({ v: 7 });

    await vi.waitFor(() => expect(rc.get()).toEqual({ v: 7 }), { timeout: 2000 });
    stop();
  });

  it('stops observing after the returned function is called', async () => {
    const spec = { n: field.number() };
    const local = new SharedMemory(spec);
    const remote = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(local.totalBytes);
    local.bind(buffer);
    remote.bind(buffer);

    const rc = reactive(local.connector('n'));
    const stop = rc.observeRemote();
    stop();
    remote.connector('n').write(5);
    await new Promise((r) => setTimeout(r, 150));
    expect(rc.get()).toBe(0);
  });

  it('watch() fires with the current value, then on every write (local or remote)', async () => {
    const spec = { n: field.number() };
    const local = new SharedMemory(spec);
    const remote = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(local.totalBytes);
    local.bind(buffer);
    remote.bind(buffer);

    const seen: number[] = [];
    const stop = watch(local.connector('n'), (v) => seen.push(v));
    await vi.waitFor(() => expect(seen).toEqual([0])); // current value on subscribe

    remote.connector('n').write(7); // remote write
    await vi.waitFor(() => expect(seen).toEqual([0, 7]));

    local.connector('n').write(9); // local write bumps the same counter
    await vi.waitFor(() => expect(seen).toEqual([0, 7, 9]));
    stop();
  });

  it('watch() with a selector only fires when the slice changes', async () => {
    const spec = { o: field.object<{ v: number; tag: string }>(128) };
    const local = new SharedMemory(spec);
    const remote = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(local.totalBytes);
    local.bind(buffer);
    remote.bind(buffer);

    const seen: (number | undefined)[] = [];
    const stop = watch(local.connector('o'), (o) => o?.v, (v) => seen.push(v));
    remote.connector('o').write({ v: 1, tag: 'a' });
    await vi.waitFor(() => expect(seen).toEqual([1]));

    remote.connector('o').write({ v: 1, tag: 'b' }); // slice unchanged → no fire
    remote.connector('o').write({ v: 2, tag: 'c' });
    await vi.waitFor(() => expect(seen).toEqual([1, 2]));
    stop();
  });

  it('watch() with equals controls what counts as a slice change', async () => {
    const spec = { m: field.object<{ v: number; tag: string }>(128) };
    const local = new SharedMemory(spec);
    const remote = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(local.totalBytes);
    local.bind(buffer);
    remote.bind(buffer);

    // Object slice — fresh object on every write, so Object.is would emit
    // every time; shallowEqual emits only when the contents differ.
    const seen: { v: number }[] = [];
    const stop = watch(
      local.connector('m'),
      (m) => (m ? { v: m.v } : undefined),
      (s) => seen.push(s as { v: number }),
      { equals: shallowEqual }
    );
    remote.connector('m').write({ v: 1, tag: 'a' });
    await vi.waitFor(() => expect(seen).toEqual([{ v: 1 }]));

    remote.connector('m').write({ v: 1, tag: 'b' }); // slice contents equal → muted
    remote.connector('m').write({ v: 2, tag: 'c' });
    await vi.waitFor(() => expect(seen).toEqual([{ v: 1 }, { v: 2 }]));
    stop();
  });

  it('watch() with a custom comparator can mute noise below a threshold', async () => {
    const spec = { n: field.number() };
    const local = new SharedMemory(spec);
    const remote = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(local.totalBytes);
    local.bind(buffer);
    remote.bind(buffer);

    const seen: number[] = [];
    const stop = watch(
      local.connector('n'),
      (v) => v,
      (v) => seen.push(v),
      { equals: (a, b) => Math.abs(a - b) < 10 }
    );
    await vi.waitFor(() => expect(seen).toEqual([0]));

    remote.connector('n').write(5);   // |5-0| < 10 → muted
    remote.connector('n').write(7);   // |7-0| < 10 → muted (memo kept 0)
    remote.connector('n').write(15);  // |15-0| >= 10 → emit
    await vi.waitFor(() => expect(seen).toEqual([0, 15]));
    stop();
  });

  it('watch() stops after the returned function is called', async () => {
    const spec = { n: field.number() };
    const local = new SharedMemory(spec);
    const remote = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(local.totalBytes);
    local.bind(buffer);
    remote.bind(buffer);

    const seen: number[] = [];
    const stop = watch(local.connector('n'), (v) => seen.push(v));
    await vi.waitFor(() => expect(seen).toEqual([0]));
    stop();
    remote.connector('n').write(5);
    await new Promise((r) => setTimeout(r, 150));
    expect(seen).toEqual([0]);
  });

  it('throws when the connector has no version counter', () => {
    const bare: Connector<number> = { byteOffset: 0, byteLength: 8, read: () => 0, write: () => undefined };
    expect(() => reactive(bare).observeRemote()).toThrow(/remote observation/);
  });

  it('falls back to a 50ms poll when Atomics.waitAsync is unavailable', async () => {
    const spec = { n: field.number() };
    const local = new SharedMemory(spec);
    const remote = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(local.totalBytes);
    local.bind(buffer);
    remote.bind(buffer);

    // Real Atomics with waitAsync hidden — connector writes still use the
    // prototype's add/notify, reactive.ts takes the polling branch.
    const withoutWaitAsync = Object.create(Atomics);
    withoutWaitAsync.waitAsync = undefined;
    vi.stubGlobal('Atomics', withoutWaitAsync);
    try {
      const rc = reactive(local.connector('n'));
      const stop = rc.observeRemote();
      remote.connector('n').write(33);
      await vi.waitFor(() => expect(rc.get()).toBe(33), { timeout: 2000 });

      stop(); // clears the interval
      remote.connector('n').write(44);
      await new Promise((r) => setTimeout(r, 150));
      expect(rc.get()).toBe(33);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shallowEqual treats undefined as unequal to any object', () => {
    expect(shallowEqual({ a: 1 }, undefined)).toBe(false);
    expect(shallowEqual(undefined, { a: 1 })).toBe(false);
    expect(shallowEqual(undefined, undefined)).toBe(true);
  });

  it('handles a synchronous waitAsync result before parking on the async wait', async () => {
    const spec = { n: field.number() };
    const local = new SharedMemory(spec);
    const remote = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(local.totalBytes);
    local.bind(buffer);
    remote.bind(buffer);

    // First call resolves synchronously (value already differs); subsequent
    // calls park on a real async wait so the loop yields.
    const orig = Atomics.waitAsync!.bind(Atomics);
    let calls = 0;
    const fake = Object.create(Atomics);
    fake.waitAsync = (...args: Parameters<typeof Atomics.waitAsync>) =>
      ++calls === 1
        ? ({ async: false, value: 'not-equal' } as ReturnType<typeof Atomics.waitAsync>)
        : orig(...args);
    vi.stubGlobal('Atomics', fake);
    try {
      const rc = reactive(local.connector('n'));
      const stop = rc.observeRemote();
      remote.connector('n').write(50);
      await vi.waitFor(() => expect(rc.get()).toBe(50), { timeout: 2000 });
      expect(calls).toBeGreaterThanOrEqual(2);
      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('polling observer ignores ticks without a version bump', async () => {
    vi.useFakeTimers();
    const withoutWaitAsync = Object.create(Atomics);
    withoutWaitAsync.waitAsync = undefined;
    const loadSpy = vi.fn(Atomics.load.bind(Atomics));
    withoutWaitAsync.load = loadSpy;
    vi.stubGlobal('Atomics', withoutWaitAsync);
    try {
      const rc = reactive(boundConnector({ n: field.number() }, 'n'));
      const stop = rc.observeRemote();
      await vi.advanceTimersByTimeAsync(120); // ~2 poll ticks, no writes
      expect(loadSpy.mock.calls.length).toBeGreaterThan(1); // ticks ran
      expect(rc.get()).toBe(0);                             // unchanged → no bump
      stop();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
