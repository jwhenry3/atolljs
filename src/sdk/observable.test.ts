// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { SharedMemory, field } from './contract/sharedMemory';
import { observe } from './observable';
import { shallowEqual } from './reactive';

const boundMem = <T extends Record<string, any>>(spec: T) => {
  const mem = new SharedMemory(spec);
  mem.bind(new SharedArrayBuffer(mem.totalBytes));
  return mem;
};

describe('observe', () => {
  it('emits the field value on subscribe and on writes', async () => {
    const mem = boundMem({ n: field.number() });
    const obs = observe(mem, 'n');
    const seen: (number | undefined)[] = [];
    const unsub = obs.subscribe((v) => seen.push(v));
    await vi.waitFor(() => expect(seen).toEqual([0]));

    mem.connector('n').write(4);
    await vi.waitFor(() => expect(seen).toEqual([0, 4]));
    unsub();
  });

  it('get() returns the current value and undefined before writes', () => {
    const mem = boundMem({ o: field.object<{ v: number }>({ maxBytes: 64 }) });
    const obs = observe(mem, 'o');
    expect(obs.get()).toBeUndefined();
    mem.connector('o').write({ v: 3 });
    expect(obs.get()).toEqual({ v: 3 });
  });

  it('slice form: get() returns the selected slice', () => {
    const spec = { m: field.object<{ v: number; tag: string }>({ maxBytes: 128 }) };
    const mem = boundMem(spec);
    const obs = observe(mem, 'm', (m) => m.v);
    mem.connector('m').write({ v: 7, tag: 'x' });
    expect(obs.get()).toBe(7);
  });

  it('slice form: emits only when the selected slice changes', async () => {
    const spec = { m: field.object<{ v: number; tag: string }>({ maxBytes: 128 }) };
    const mem = boundMem(spec);
    const obs = observe(mem, 'm', (m) => m.v);
    const seen: (number | undefined)[] = [];
    const unsub = obs.subscribe((v) => seen.push(v));

    mem.connector('m').write({ v: 1, tag: 'a' });
    await vi.waitFor(() => expect(seen).toEqual([1]));
    mem.connector('m').write({ v: 1, tag: 'b' }); // same slice → no emit
    mem.connector('m').write({ v: 2, tag: 'c' });
    await vi.waitFor(() => expect(seen).toEqual([1, 2]));
    unsub();
  });

  it('slice + equals: custom comparator controls emission', async () => {
    const spec = { m: field.object<{ v: number; tag: string }>({ maxBytes: 128 }) };
    const mem = boundMem(spec);
    const obs = observe(
      mem,
      'm',
      (m) => ({ v: m.v }),
      { equals: shallowEqual }
    );
    const seen: { v: number }[] = [];
    const unsub = obs.subscribe((v) => seen.push(v as { v: number }));

    mem.connector('m').write({ v: 1, tag: 'a' });
    await vi.waitFor(() => expect(seen).toEqual([{ v: 1 }]));
    mem.connector('m').write({ v: 1, tag: 'b' }); // shallow-equal slice → muted
    mem.connector('m').write({ v: 2, tag: 'c' });
    await vi.waitFor(() => expect(seen).toEqual([{ v: 1 }, { v: 2 }]));
    unsub();
  });

  it('get() keeps the same reference while the comparator says unchanged', async () => {
    const spec = { m: field.object<{ v: number; tag: string }>({ maxBytes: 128 }) };
    const mem = boundMem(spec);
    const obs = observe(mem, 'm', (m) => ({ v: m.v }), { equals: shallowEqual });
    const unsub = obs.subscribe(() => {});
    mem.connector('m').write({ v: 1, tag: 'a' });
    const first = obs.get();
    mem.connector('m').write({ v: 1, tag: 'b' });
    // shallow-equal slice → same snapshot reference
    await new Promise((r) => setTimeout(r, 50));
    expect(obs.get()).toBe(first);
    unsub();
  });

  it('activates late when subscribed before the contract is bound', async () => {
    const mem = new SharedMemory({ n: field.number() });
    const obs = observe(mem, 'n');
    const seen: (number | undefined)[] = [];
    obs.subscribe((v) => seen.push(v));
    expect(obs.get()).toBeUndefined();

    mem.bind(new SharedArrayBuffer(mem.totalBytes));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(obs.get()).toBe(0);
  });

  it('keeps the underlying watch alive while any subscriber remains', async () => {
    const mem = boundMem({ n: field.number() });
    const obs = observe(mem, 'n');
    const a: (number | undefined)[] = [];
    const b: (number | undefined)[] = [];
    const offA = obs.subscribe((v) => a.push(v));
    obs.subscribe((v) => b.push(v));
    await vi.waitFor(() => expect(a).toEqual([0]));

    offA(); // one subscriber left — watch must stay live
    mem.connector('n').write(9);
    await vi.waitFor(() => expect(b).toEqual([9])); // b joined after the initial emit
  });
});
