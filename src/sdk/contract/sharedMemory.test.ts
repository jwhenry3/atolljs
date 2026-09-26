import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { msgpackCodec } from './msgpackCodec';
import { Codec, Connector, SharedMemory, SharedSpec, defineSharedMemory, field, registerConnectorFactory } from './sharedMemory';
import { structSchema } from './structSchema';

function bound<S extends SharedSpec>(spec: S) {
  const mem = defineSharedMemory(spec);
  mem.bind(new SharedArrayBuffer(mem.totalBytes));
  return mem;
}

describe('SharedMemory layout', () => {
  it('assigns aligned offsets deterministically', () => {
    const spec = { a: field.number(), b: field.uint8Array(3), c: field.number() };
    const m1 = new SharedMemory(spec);
    const m2 = new SharedMemory(spec);
    // a@0 (8B), b@8 (3B), c@16 (8B), fields end at 24, version block 3*4B aligned to 16
    expect(m1.totalBytes).toBe(40);
    expect(m1.totalBytes).toBe(m2.totalBytes);
  });
});

describe('connectors', () => {
  it('round-trips numbers', () => {
    const c = bound({ n: field.number() }).connector('n');
    expect(c.read()).toBe(0);
    c.write(3.14);
    expect(c.read()).toBe(3.14);
  });

  it('round-trips booleans', () => {
    const c = bound({ b: field.boolean() }).connector('b');
    expect(c.read()).toBe(false);
    c.write(true);
    expect(c.read()).toBe(true);
  });

  it('round-trips strings including unicode', () => {
    const c = bound({ s: field.string(64) }).connector('s');
    expect(c.read()).toBe('');
    c.write('héllo ✓');
    expect(c.read()).toBe('héllo ✓');
  });

  it('rejects strings exceeding capacity', () => {
    const c = bound({ s: field.string(4) }).connector('s');
    expect(() => c.write('more than four bytes')).toThrow(/capacity/);
  });

  it('returns undefined for unwritten object/array fields', () => {
    const mem = bound({ o: field.object(64), a: field.array(64) });
    expect(mem.connector('o').read()).toBeUndefined();
    expect(mem.connector('a').read()).toBeUndefined();
  });

  it('round-trips objects', () => {
    const c = bound({ o: field.object<{ x: number }>(64) }).connector('o');
    c.write({ x: 1 });
    expect(c.read()).toEqual({ x: 1 });
  });

  it('round-trips arrays', () => {
    const c = bound({ a: field.array<number>(64) }).connector('a');
    c.write([1, 2, 3]);
    expect(c.read()).toEqual([1, 2, 3]);
  });

  it('exposes typed arrays as live zero-copy views', () => {
    const c = bound({ v: field.float64Array(4) }).connector('v');
    const view = c.read();
    expect(view).toBeInstanceOf(Float64Array);
    view[0] = 42.5;
    expect(c.read()[0]).toBe(42.5);
  });

  it('throws when a typed-array write exceeds the region', () => {
    const c = bound({ v: field.int32Array(2) }).connector('v');
    expect(() => c.write(new Int32Array([1, 2, 3]))).toThrow();
  });

  it('validates object writes against the schema', () => {
    const c = bound({ o: field.object(128, z.object({ n: z.number() })) }).connector('o');
    expect(() => c.write({ n: 'nope' } as any)).toThrow();
    expect(() => c.write({ wrong: true } as any)).toThrow();
  });

  it('validates object reads against the schema', () => {
    const mem = new SharedMemory({ o: field.object(128, z.object({ n: z.number() })) });
    const buf = new SharedArrayBuffer(mem.totalBytes);
    mem.bind(buf);
    const c = mem.connector('o');
    // Write a wrong-shaped payload directly into the field's region
    const bytes = new TextEncoder().encode('{"n":"corrupt"}');
    new Uint32Array(buf, c.byteOffset, 1)[0] = bytes.byteLength;
    new Uint8Array(buf, c.byteOffset + 4, bytes.byteLength).set(bytes);
    expect(() => c.read()).toThrow();
  });

  it('bumps the shared version counter on every write', () => {
    const c = bound({ n: field.number() }).connector('n');
    expect(c._version).toBeDefined();
    c.write(1);
    c.write(2);
    expect(Atomics.load(c._version!.view, c._version!.index)).toBe(2);
  });

  it('keeps version counters independent per field', () => {
    const mem = bound({ a: field.number(), b: field.number() });
    mem.connector('a').write(1);
    expect(Atomics.load(mem.connector('a')._version!.view, 0)).toBe(1);
    expect(Atomics.load(mem.connector('b')._version!.view, 1)).toBe(0);
  });

  it('throws a clear error when accessed before binding', () => {
    const mem = new SharedMemory({ n: field.number() });
    expect(() => mem.connector('n')).toThrow(/before the buffer was bound/);
  });
});

describe('codecs', () => {
  it('uses a custom codec for object/array fields', () => {
    const encode = vi.fn((v: unknown) => new TextEncoder().encode(JSON.stringify(v)));
    const decode = vi.fn((b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)));
    const codec: Codec = { encode, decode };
    const mem = new SharedMemory({ o: field.object<{ x: number }>(64) }, { codec });
    mem.bind(new SharedArrayBuffer(mem.totalBytes));

    mem.connector('o').write({ x: 9 });
    expect(mem.connector('o').read()).toEqual({ x: 9 });
    expect(encode).toHaveBeenCalledWith({ x: 9 });
    expect(decode).toHaveBeenCalled();
  });

  it('round-trips values through msgpack, including types JSON cannot express', () => {
    const mem = new SharedMemory(
      { blob: field.object<{ bytes: Uint8Array; nested: { ok: boolean } }>(256) },
      { codec: msgpackCodec }
    );
    mem.bind(new SharedArrayBuffer(mem.totalBytes));
    const c = mem.connector('blob');

    // JSON.stringify(Uint8Array) produces an object, not binary — msgpack keeps it
    c.write({ bytes: new Uint8Array([1, 2, 3]), nested: { ok: true } });
    const result = c.read() as any;
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.nested).toEqual({ ok: true });
  });

  it('produces smaller payloads than JSON for structured data', () => {
    const entities = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `entity-${i}`,
      position: { x: i * 1.5, y: -i },
      active: i % 2 === 0,
    }));
    const jsonBytes = new TextEncoder().encode(JSON.stringify(entities));
    const packed = msgpackCodec.encode(entities);
    expect(packed.byteLength).toBeLessThan(jsonBytes.byteLength);
  });

  it('still validates msgpack-decoded values against the field schema', () => {
    const mem = new SharedMemory(
      { o: field.object(128, z.object({ n: z.number() })) },
      { codec: msgpackCodec }
    );
    const buf = new SharedArrayBuffer(mem.totalBytes);
    mem.bind(buf);
    const c = mem.connector('o');
    const bad = msgpackCodec.encode({ n: 'corrupt' });
    new Uint32Array(buf, c.byteOffset, 1)[0] = bad.byteLength;
    new Uint8Array(buf, c.byteOffset + 4, bad.byteLength).set(bad);
    expect(() => c.read()).toThrow();
  });
});

describe('browser restrictions', () => {
  it('never passes shared views to TextDecoder', () => {
    // Browsers reject SharedArrayBuffer-backed views in TextDecoder.decode;
    // Node allows it, so enforce the restriction explicitly.
    class StrictDecoder extends TextDecoder {
      decode(input?: any, options?: any) {
        if (input?.buffer instanceof SharedArrayBuffer) {
          throw new TypeError('The provided ArrayBufferView value must not be shared.');
        }
        return super.decode(input, options);
      }
    }
    vi.stubGlobal('TextDecoder', StrictDecoder);
    try {
      const mem = bound({
        s: field.string(64),
        o: field.object<{ x: number }>(64),
        a: field.array<number>(64),
      });
      mem.connector('s').write('hello');
      expect(mem.connector('s').read()).toBe('hello');
      mem.connector('o').write({ x: 1 });
      expect(mem.connector('o').read()).toEqual({ x: 1 });
      mem.connector('a').write([1, 2]);
      expect(mem.connector('a').read()).toEqual([1, 2]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('cross-instance sharing (simulated threads)', () => {
  it('sees writes made through a second binding of the same contract', () => {
    const spec = { n: field.number(), o: field.object<{ v: string }>(64) };
    const a = new SharedMemory(spec);
    const b = new SharedMemory(spec);
    const buffer = new SharedArrayBuffer(a.totalBytes);
    a.bind(buffer);
    b.bind(buffer);

    a.connector('n').write(99);
    expect(b.connector('n').read()).toBe(99);

    b.connector('o').write({ v: 'from-worker' });
    expect(a.connector('o').read()).toEqual({ v: 'from-worker' });
  });
});

describe('defineSharedMemory', () => {
  it('exposes typed field accessors', () => {
    const mem = defineSharedMemory({ n: field.number() });
    const buf = new SharedArrayBuffer(mem.totalBytes);
    mem.bind(buf);
    const c: Connector<number> = mem.n;
    c.write(7);
    expect(mem.n.read()).toBe(7);
  });
});

describe('struct fields (fixed-layout records)', () => {
  const recordSpec = {
    id: 'u32',
    price: 'f64',
    quantity: 'u16',
    active: 'u8',
    tag: { string: 12 },
  } as const;

  it('computes a deterministic, naturally-aligned record layout', () => {
    const d = field.struct(recordSpec, 10);
    // id@0(4) → pad→ price@8(8) → quantity@16(2) → active@18(1) → tag@19(12) → 31, align8 → 32
    expect(d.struct.offsets).toEqual({ id: 0, price: 8, quantity: 16, active: 18, tag: 19 });
    expect(d.struct.recordSize).toBe(32);
    expect(d.byteLength).toBe(320);
  });

  it('reads and writes individual records with zero serialization', () => {
    const mem = bound({ recs: field.struct(recordSpec, 4) });
    mem.recs.writeAt(1, { id: 42, price: 9.5, quantity: 3, active: 1, tag: 'sku-0001' });
    mem.recs.writeAt(3, { id: 7, price: -2.25, quantity: 65535, active: 0, tag: 'x' });

    expect(mem.recs.readAt(1)).toEqual({ id: 42, price: 9.5, quantity: 3, active: 1, tag: 'sku-0001' });
    expect(mem.recs.readAt(3)).toEqual({ id: 7, price: -2.25, quantity: 65535, active: 0, tag: 'x' });
    expect(mem.recs.recordCount).toBe(4);
    expect(mem.recs.recordSize).toBe(32);
  });

  it('supports bigint via i64/u64 fields', () => {
    const mem = bound({ recs: field.struct({ ts: 'u64', delta: 'i64' }, 2) });
    mem.recs.writeAt(0, { ts: 1764000000000000000n, delta: -5n });
    expect(mem.recs.readAt(0)).toEqual({ ts: 1764000000000000000n, delta: -5n });
  });

  it('readAt can reuse an output object for allocation-free scans', () => {
    const mem = bound({ recs: field.struct({ v: 'i32' }, 3) });
    mem.recs.writeAt(0, { v: 10 });
    mem.recs.writeAt(2, { v: 30 });
    const out = { v: 0 };
    let sum = 0;
    for (let i = 0; i < 3; i++) sum += mem.recs.readAt(i, out).v;
    expect(sum).toBe(40);
  });

  it('enforces index bounds and inline string capacity', () => {
    const mem = bound({ recs: field.struct(recordSpec, 2) });
    expect(() => mem.recs.writeAt(2, { id: 1, price: 0, quantity: 0, active: 0, tag: '' })).toThrow(RangeError);
    expect(() =>
      mem.recs.writeAt(0, { id: 1, price: 0, quantity: 0, active: 0, tag: 'this-tag-is-far-too-long' })
    ).toThrow(/exceeds inline field capacity/);
  });

  it('write() persists a whole array and rejects overflow', () => {
    const mem = bound({ recs: field.struct({ v: 'i32' }, 2) });
    mem.recs.write([{ v: 1 }, { v: 2 }]);
    expect(mem.recs.read()).toEqual([{ v: 1 }, { v: 2 }]);
    expect(() => mem.recs.write([{ v: 1 }, { v: 2 }, { v: 3 }])).toThrow(/capacity/);
  });

  it('is visible across separately bound instances on the same buffer', () => {
    const spec = { recs: field.struct({ v: 'i32', flag: 'u8' }, 4) };
    const buf = new SharedArrayBuffer(new SharedMemory(spec).totalBytes);
    const a = new SharedMemory(spec);
    const b = new SharedMemory(spec);
    a.bind(buf);
    b.bind(buf);
    a.connector('recs').writeAt(2, { v: 99, flag: 1 });
    expect(b.connector('recs').readAt(2)).toEqual({ v: 99, flag: 1 });
  });

  it('writeAt is pure memory access; commit() bumps the version counter', () => {
    const mem = bound({ recs: field.struct({ v: 'i32' }, 2) });
    const { view, index } = mem.recs._version!;
    const before = view[index];
    mem.recs.writeAt(0, { v: 1 });
    expect(view[index]).toBe(before); // no implicit bump — hot loop stays cheap
    mem.recs.commit();
    expect(view[index]).toBe(before + 1);
  });

  it('readAt supports field projection', () => {
    const mem = bound({ recs: field.struct(recordSpec, 2) });
    mem.recs.writeAt(0, { id: 5, price: 1.5, quantity: 2, active: 1, tag: 'abc' });
    const partial = mem.recs.readAt(0, {}, ['id', 'price']);
    expect(partial).toEqual({ id: 5, price: 1.5 });
  });

  it('writeAt with a field list updates only those fields', () => {
    const mem = bound({ recs: field.struct(recordSpec, 2) });
    mem.recs.writeAt(0, { id: 5, price: 1.5, quantity: 2, active: 1, tag: 'abc' });
    mem.recs.writeAt(0, { price: 9.9, quantity: 7 }, ['price', 'quantity']);
    expect(mem.recs.readAt(0)).toEqual({ id: 5, price: 9.9, quantity: 7, active: 1, tag: 'abc' });
  });

  it('structSchema derives a storage-bounded zod schema from the spec', () => {
    const schema = structSchema(recordSpec);
    const rec = { id: 5, price: 1.5, quantity: 2, active: 1, tag: 'abc' };
    expect(schema.parse(rec)).toEqual(rec);
    // u8/u16/u32 bounds are enforced — out-of-range fails before touching memory
    expect(() => schema.parse({ ...rec, active: 256 })).toThrow();
    expect(() => schema.parse({ ...rec, quantity: 65536 })).toThrow();
    // inline strings check UTF-8 byte length, matching connector capacity
    expect(() => schema.parse({ ...rec, tag: 'this-tag-is-too-long' })).toThrow();
    // inferred type is identical to the connector's record type — parsed
    // output is directly assignable to writeAt
    const mem = bound({ recs: field.struct(recordSpec, 1) });
    mem.recs.writeAt(0, schema.parse(rec));
    expect(mem.recs.readAt(0)).toEqual(rec);
  });
});

describe('connector factory plugins', () => {
  it('resolves custom kinds via registerConnectorFactory', () => {
    registerConnectorFactory('u16-scalar', (d, ctx, byteOffset) => {
      const view = new Uint16Array(ctx.buffer, byteOffset, 1);
      return { byteOffset, byteLength: d.byteLength, read: () => view[0], write: (v: number) => { view[0] = v; } };
    });
    const mem = bound({ counter: { kind: 'u16-scalar', byteLength: 2 } });
    mem.connector('counter').write(65000);
    expect(mem.connector('counter').read()).toBe(65000);
  });

  it('per-contract plugins override the built-in factories', () => {
    const doubled = vi.fn((d: import('./sharedMemory').FieldDescriptor, ctx: import('./sharedMemory').ConnectorContext, byteOffset: number) => {
      const view = new Float64Array(ctx.buffer, byteOffset, 1);
      return { byteOffset, byteLength: d.byteLength, read: () => view[0], write: (v: number) => { view[0] = v * 2; } };
    });
    const mem = defineSharedMemory({ n: field.number() }, { plugins: { number: doubled } });
    mem.bind(new SharedArrayBuffer(mem.totalBytes));
    mem.n.write(21);
    expect(mem.n.read()).toBe(42);
    expect(doubled).toHaveBeenCalled();
  });

  it('throws for unknown field kinds at bind time', () => {
    const mem = new SharedMemory({ x: { kind: 'nope', byteLength: 8 } });
    expect(() => mem.bind(new SharedArrayBuffer(mem.totalBytes))).toThrow(/Unknown shared memory field kind/);
  });
});
