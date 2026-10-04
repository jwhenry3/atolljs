import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { $ZodType } from 'zod/v4/core';
import { msgpackrCodec } from './msgpackrCodec';
import { Codec, Connector, SharedMemory, SharedSpec, defineSharedMemory, field, registerConnectorFactory } from './sharedMemory';
import { listSchema } from './listSchema';
import { reef } from './reef';

function bound<S extends SharedSpec>(spec: S) {
  const mem = defineSharedMemory(spec);
  mem.bind(new SharedArrayBuffer(mem.totalBytes));
  return mem;
}

describe('SharedMemory layout', () => {
  it('assigns aligned offsets deterministically', () => {
    const spec = { a: field.number(), b: field.uint8Array({ length: 3 }), c: field.number() };
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
    const c = bound({ s: field.string({ maxBytes: 64 }) }).connector('s');
    expect(c.read()).toBe('');
    c.write('héllo ✓');
    expect(c.read()).toBe('héllo ✓');
  });

  it('rejects strings exceeding capacity', () => {
    const c = bound({ s: field.string({ maxBytes: 4 }) }).connector('s');
    expect(() => c.write('more than four bytes')).toThrow(/capacity/);
  });

  it('returns undefined for unwritten object/array fields', () => {
    const mem = bound({ o: field.object({ maxBytes: 64 }), a: field.array({ maxBytes: 64 }) });
    expect(mem.connector('o').read()).toBeUndefined();
    expect(mem.connector('a').read()).toBeUndefined();
  });

  it('round-trips objects', () => {
    const c = bound({ o: field.object<{ x: number }>({ maxBytes: 64 }) }).connector('o');
    c.write({ x: 1 });
    expect(c.read()).toEqual({ x: 1 });
  });

  it('round-trips arrays', () => {
    const c = bound({ a: field.array<number>({ maxBytes: 64 }) }).connector('a');
    c.write([1, 2, 3]);
    expect(c.read()).toEqual([1, 2, 3]);
  });

  it('exposes typed arrays as live zero-copy views', () => {
    const c = bound({ v: field.float64Array({ length: 4 }) }).connector('v');
    const view = c.read();
    expect(view).toBeInstanceOf(Float64Array);
    view[0] = 42.5;
    expect(c.read()[0]).toBe(42.5);
  });

  it('throws when a typed-array write exceeds the region', () => {
    const c = bound({ v: field.int32Array({ length: 2 }) }).connector('v');
    expect(() => c.write(new Int32Array([1, 2, 3]))).toThrow();
  });

  it('validates object writes against the schema', () => {
    const c = bound({ o: field.object({ maxBytes: 128, schema: z.object({ n: z.number() }) }) }).connector('o');
    expect(() => c.write({ n: 'nope' } as any)).toThrow();
    expect(() => c.write({ wrong: true } as any)).toThrow();
  });

  it('validates object reads against the schema', () => {
    const mem = new SharedMemory({ o: field.object({ maxBytes: 128, schema: z.object({ n: z.number() }) }) });
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
    const mem = new SharedMemory({ o: field.object<{ x: number }>({ maxBytes: 64 }) }, { codec });
    mem.bind(new SharedArrayBuffer(mem.totalBytes));

    mem.connector('o').write({ x: 9 });
    expect(mem.connector('o').read()).toEqual({ x: 9 });
    expect(encode).toHaveBeenCalledWith({ x: 9 });
    expect(decode).toHaveBeenCalled();
  });

  it('round-trips values through msgpack, including types JSON cannot express', () => {
    const mem = new SharedMemory(
      { blob: field.object<{ bytes: Uint8Array; nested: { ok: boolean } }>({ maxBytes: 256 }) },
      { codec: msgpackrCodec }
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
    const packed = msgpackrCodec.encode(entities);
    expect(packed.byteLength).toBeLessThan(jsonBytes.byteLength);
  });

  it('still validates msgpack-decoded values against the field schema', () => {
    const mem = new SharedMemory(
      { o: field.object({ maxBytes: 128, schema: z.object({ n: z.number() }) }) },
      { codec: msgpackrCodec }
    );
    const buf = new SharedArrayBuffer(mem.totalBytes);
    mem.bind(buf);
    const c = mem.connector('o');
    const bad = msgpackrCodec.encode({ n: 'corrupt' });
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
        s: field.string({ maxBytes: 64 }),
        o: field.object<{ x: number }>({ maxBytes: 64 }),
        a: field.array<number>({ maxBytes: 64 }),
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
    const spec = { n: field.number(), o: field.object<{ v: string }>({ maxBytes: 64 }) };
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

describe('list fields (fixed-layout records)', () => {
  const recordSchema = reef.object({
    id: reef.u32(),
    price: reef.f64(),
    quantity: reef.u16(),
    active: reef.u8(),
    tag: reef.string(12),
  });

  it('computes a deterministic, naturally-aligned record layout', () => {
    const d = field.list({ schema: recordSchema, count: 10 });
    // id@0(4) → pad→ price@8(8) → quantity@16(2) → active@18(1) → tag@19(12) → 31, align8 → 32
    expect(d.offsets).toEqual({ id: 0, price: 8, quantity: 16, active: 18, tag: 19 });
    expect(d.recordSize).toBe(32);
    expect(d.byteLength).toBe(320);
  });

  it('reads and writes individual records with zero serialization', () => {
    const mem = bound({ recs: field.list({ schema: recordSchema, count: 4 }) });
    mem.recs.writeAt(1, { id: 42, price: 9.5, quantity: 3, active: 1, tag: 'sku-0001' });
    mem.recs.writeAt(3, { id: 7, price: -2.25, quantity: 65535, active: 0, tag: 'x' });

    expect(mem.recs.readAt(1)).toEqual({ id: 42, price: 9.5, quantity: 3, active: 1, tag: 'sku-0001' });
    expect(mem.recs.readAt(3)).toEqual({ id: 7, price: -2.25, quantity: 65535, active: 0, tag: 'x' });
    expect(mem.recs.recordCount).toBe(4);
    expect(mem.recs.recordSize).toBe(32);
  });

  it('supports bigint via i64/u64 fields', () => {
    const mem = bound({ recs: field.list({ schema: reef.object({ ts: reef.u64(), delta: reef.i64() }), count: 2 }) });
    mem.recs.writeAt(0, { ts: 1764000000000000000n, delta: -5n });
    expect(mem.recs.readAt(0)).toEqual({ ts: 1764000000000000000n, delta: -5n });
  });

  it('readAt can reuse an output object for allocation-free scans', () => {
    const mem = bound({ recs: field.list({ schema: reef.object({ v: reef.i32() }), count: 3 }) });
    mem.recs.writeAt(0, { v: 10 });
    mem.recs.writeAt(2, { v: 30 });
    const out = { v: 0 };
    let sum = 0;
    for (let i = 0; i < 3; i++) sum += mem.recs.readAt(i, out).v;
    expect(sum).toBe(40);
  });

  it('enforces index bounds and inline string capacity', () => {
    const mem = bound({ recs: field.list({ schema: recordSchema, count: 2 }) });
    expect(() => mem.recs.writeAt(2, { id: 1, price: 0, quantity: 0, active: 0, tag: '' })).toThrow(RangeError);
    expect(() =>
      mem.recs.writeAt(0, { id: 1, price: 0, quantity: 0, active: 0, tag: 'this-tag-is-far-too-long' })
    ).toThrow(/exceeds inline field capacity/);
  });

  it('write() persists a whole array and rejects overflow', () => {
    const mem = bound({ recs: field.list({ schema: reef.object({ v: reef.i32() }), count: 2 }) });
    mem.recs.write([{ v: 1 }, { v: 2 }]);
    expect(mem.recs.read()).toEqual([{ v: 1 }, { v: 2 }]);
    expect(() => mem.recs.write([{ v: 1 }, { v: 2 }, { v: 3 }])).toThrow(/capacity/);
  });

  it('is visible across separately bound instances on the same buffer', () => {
    const spec = { recs: field.list({ schema: reef.object({ v: reef.i32(), flag: reef.u8() }), count: 4 }) };
    const buf = new SharedArrayBuffer(new SharedMemory(spec).totalBytes);
    const a = new SharedMemory(spec);
    const b = new SharedMemory(spec);
    a.bind(buf);
    b.bind(buf);
    a.connector('recs').writeAt(2, { v: 99, flag: 1 });
    expect(b.connector('recs').readAt(2)).toEqual({ v: 99, flag: 1 });
  });

  it('writeAt is pure memory access; commit() bumps the version counter', () => {
    const mem = bound({ recs: field.list({ schema: reef.object({ v: reef.i32() }), count: 2 }) });
    const { view, index } = mem.recs._version!;
    const before = view[index];
    mem.recs.writeAt(0, { v: 1 });
    expect(view[index]).toBe(before); // no implicit bump — hot loop stays cheap
    mem.recs.commit();
    expect(view[index]).toBe(before + 1);
  });

  it('readAt supports field projection', () => {
    const mem = bound({ recs: field.list({ schema: recordSchema, count: 2 }) });
    mem.recs.writeAt(0, { id: 5, price: 1.5, quantity: 2, active: 1, tag: 'abc' });
    const partial = mem.recs.readAt(0, {}, ['id', 'price']);
    expect(partial).toEqual({ id: 5, price: 1.5 });
  });

  it('writeAt with a field list updates only those fields', () => {
    const mem = bound({ recs: field.list({ schema: recordSchema, count: 2 }) });
    mem.recs.writeAt(0, { id: 5, price: 1.5, quantity: 2, active: 1, tag: 'abc' });
    mem.recs.writeAt(0, { price: 9.9, quantity: 7 }, ['price', 'quantity']);
    expect(mem.recs.readAt(0)).toEqual({ id: 5, price: 9.9, quantity: 7, active: 1, tag: 'abc' });
  });

  it('compiles zod list members to the same layout as tokens', () => {
    const d = field.list({
      schema: reef.object({
        id: z.uint32(),                          // format → 'u32'
        delta: z.int64(),                        // bigint format → 'i64'
        ratio: z.float32(),                      // 'f32'
        level: z.number().int().min(0).max(3),   // bounds → narrowest int
        code: z.string().meta({ bytes: 8 }),     // meta → inline string
        legacy: reef.u16(),
      }),
      count: 2,
    });
    expect(d.layout).toEqual({
      id: 'u32', delta: 'i64', ratio: 'f32', level: 'u8', code: { string: 8 }, legacy: 'u16',
    });
    // the declared schema keeps the zod members; layout holds the compiled tokens
    expect(d.schema.shape.id).toBeInstanceOf($ZodType);
    expect(d.recordSize).toBe(32); // 4 + 8 + 4 + 1 + 8 + 2 → align8
  });

  it('zod members read/write through the connector identically to tokens', () => {
    const mem = bound({
      recs: field.list({
        schema: reef.object({ id: z.uint32(), tag: z.string().meta({ bytes: 6 }), n: reef.u8() }),
        count: 2,
      }),
    });
    mem.recs.writeAt(0, { id: 42, tag: 'abc', n: 7 });
    expect(mem.recs.readAt(0)).toEqual({ id: 42, tag: 'abc', n: 7 });
  });

  it('reef helpers compile every scalar width with one spelling', () => {
    const d = field.list({
      schema: reef.object({
        a: reef.i8(), b: reef.u8(), c: reef.i16(), d: reef.u16(),
        e: reef.i32(), f: reef.u32(), g: reef.f32(), h: reef.f64(),
        i: reef.i64(), j: reef.u64(),
        bounded: reef.int(0, 3),
        tag: reef.string(6),
      }),
      count: 1,
    });
    expect(d.layout).toEqual({
      a: 'i8', b: 'u8', c: 'i16', d: 'u16',
      e: 'i32', f: 'u32', g: 'f32', h: 'f64',
      i: 'i64', j: 'u64',
      bounded: 'u8', tag: { string: 6 },
    });
    // reef members are real zod schemas — validation comes with the declaration
    expect(() => d.schema.shape.b.parse(300)).toThrow();
    expect(d.schema.shape.b.parse(200)).toBe(200);
  });

  it('schemas keep declared domain bounds — stricter than the storage width', () => {
    const mem = bound({
      recs: field.list({ schema: reef.object({ level: z.number().int().min(0).max(3) }), count: 1 }),
    });
    expect(mem.schemas.recs.parse({ level: 2 })).toEqual({ level: 2 });
    expect(() => mem.schemas.recs.parse({ level: 9 })).toThrow(); // 9 fits u8, not 0..3
  });

  it('rejects zod members that cannot express a fixed-width layout', () => {
    expect(() => field.list({
      schema: reef.object({ when: z.date() }), count: 1,
    })).toThrow(/can't lay out/);
    expect(() => field.list({
      schema: reef.object({ s: z.string() }), count: 1, // no .meta({ bytes }) — capacity unknown
    })).toThrow(/meta\(\{ bytes: n \}\)/);
  });

  it('listSchema derives a storage-bounded zod schema from the spec', () => {
    const schema = listSchema(recordSchema.shape);
    const rec = { id: 5, price: 1.5, quantity: 2, active: 1, tag: 'abc' };
    expect(schema.parse(rec)).toEqual(rec);
    // u8/u16/u32 bounds are enforced — out-of-range fails before touching memory
    expect(() => schema.parse({ ...rec, active: 256 })).toThrow();
    expect(() => schema.parse({ ...rec, quantity: 65536 })).toThrow();
    // inline strings check UTF-8 byte length, matching connector capacity
    expect(() => schema.parse({ ...rec, tag: 'this-tag-is-too-long' })).toThrow();
    // inferred type is identical to the connector's record type — parsed
    // output is directly assignable to writeAt
    const mem = bound({ recs: field.list({ schema: recordSchema, count: 1 }) });
    mem.recs.writeAt(0, schema.parse(rec));
    expect(mem.recs.readAt(0)).toEqual(rec);
  });
});

describe('schema-derived fixed layouts', () => {
  it('field.object derives byteLength from the schema — no maxBytes', () => {
    const d = field.object({
      schema: reef.object({ total: reef.f64(), open: reef.u32(), flag: reef.boolean(), tag: reef.string(8) }),
    });
    expect(d.kind).toBe('object');
    expect(d.layout).toEqual({ total: 'f64', open: 'u32', flag: { bool: true }, tag: { string: 8 } });
    expect(d.recordSize).toBe(24); // 8 + 4 + 1 + 8 → align8
    expect(d.byteLength).toBe(32); // 8-byte header + record
  });

  it('fixed objects round-trip inline — no codec, undefined until written', () => {
    const mem = bound({
      snapshot: field.object({ schema: reef.object({ total: reef.f64(), open: reef.u32(), flag: reef.boolean(), tag: reef.string(8) }) }),
    });
    expect(mem.snapshot.read()).toBeUndefined();
    mem.snapshot.write({ total: 1.5, open: 7, flag: true, tag: 'hi' });
    expect(mem.snapshot.read()).toEqual({ total: 1.5, open: 7, flag: true, tag: 'hi' });
    // identical memory on a second binding sees the same value
    const spec = { snapshot: field.object({ schema: reef.object({ total: reef.f64(), open: reef.u32() }) }) };
    const buf = new SharedArrayBuffer(new SharedMemory(spec).totalBytes);
    const a = new SharedMemory(spec);
    const b = new SharedMemory(spec);
    a.bind(buf);
    b.bind(buf);
    a.connector('snapshot').write({ total: 9, open: 3 });
    expect(b.connector('snapshot').read()).toEqual({ total: 9, open: 3 });
  });

  it('fixed object writes validate against the declared schema', () => {
    const mem = bound({ s: field.object({ schema: reef.object({ n: reef.u8() }) }) });
    expect(() => mem.s.write({ n: 300 })).toThrow(); // u8 domain bound
    mem.s.write({ n: 3 });
    expect(mem.s.read()).toEqual({ n: 3 });
  });

  it('field.array derives capacity from .max(n) / .length(n)', () => {
    const bounded = field.array({ schema: reef.array(reef.u32()).max(4) });
    expect(bounded.element).toBe('u32');
    expect(bounded.capacity).toBe(4);
    expect(bounded.byteLength).toBe(8 + 4 * 4);
    const exact = field.array({ schema: reef.array(reef.string(6)).length(3) });
    expect(exact.capacity).toBe(3);

    const mem = bound({ tags: field.array({ schema: reef.array(reef.u8()).max(4) }) });
    expect(mem.tags.read()).toBeUndefined();
    mem.tags.write([1, 2]);
    expect(mem.tags.read()).toEqual([1, 2]);
    mem.tags.write([]); // empty is a written value
    expect(mem.tags.read()).toEqual([]);
    expect(() => mem.tags.write([1, 2, 3, 4, 5])).toThrow(/<=4 items|capacity of 4/);
  });

  it('field.string derives its budget from reef.string(n)', () => {
    const d = field.string({ schema: reef.string(10) });
    expect(d.byteLength).toBe(14); // 4-byte length header + 10
    const mem = bound({ label: field.string({ schema: reef.string(10) }) });
    mem.label.write('within');
    expect(mem.label.read()).toBe('within');
    expect(() => mem.label.write('exceeds ten bytes')).toThrow();
  });

  it('fluent schema methods attach checks, meta, and bounds', () => {
    expect(reef.u8().parse(7)).toBe(7);
    expect(() => reef.u8().parse(256)).toThrow();

    // .refine keeps def.type — the schema still introspects as a string
    const tagged = reef.string(4).refine((v) => v.startsWith('x')).meta({ bytes: 4 });
    expect(tagged.meta()).toEqual({ bytes: 4 });
    expect(tagged.parse('xy')).toBe('xy');
    expect(() => tagged.parse('ab')).toThrow();

    // .min/.max dispatch — numeric bounds on numbers, length bounds on arrays
    expect(() => reef.i32().min(0).parse(-1)).toThrow();
    expect(() => reef.i32().int().parse(1.5)).toThrow();
    const arr = reef.array(reef.u8()).min(1).max(2);
    expect(() => arr.parse([])).toThrow();
    expect(() => arr.parse([1, 2, 3])).toThrow();
    expect(arr.parse([1])).toEqual([1]);
  });

  it('rejects schemas with no derivable width when maxBytes is absent', () => {
    expect(() => field.object({ schema: z.string() as never })).toThrow(/maxBytes/);
    expect(() => field.object({ schema: reef.object({ note: z.string() }) })).toThrow(/bytes/);
    expect(() => field.array({ schema: z.array(z.number()) })).toThrow(/\.max\(n\) or \.length\(n\)/);
    expect(() => field.array({ schema: z.array(z.date()).max(2) })).toThrow(/fixed-width|field\.list/);
    expect(() => field.string({ schema: z.string() })).toThrow(/bytes|maxBytes/);
  });

  it('codec-encoded object/array fields keep working with explicit maxBytes', () => {
    const mem = bound({
      obj: field.object({ maxBytes: 256, schema: z.object({ note: z.string() }) }),
      arr: field.array({ maxBytes: 256, schema: z.array(z.string()) }),
    });
    mem.obj.write({ note: 'dynamic' });
    mem.arr.write(['a', 'b', 'c']);
    expect(mem.obj.read()).toEqual({ note: 'dynamic' });
    expect(mem.arr.read()).toEqual(['a', 'b', 'c']);
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

describe('edge coverage', () => {
  it('supports bigInt64Array fields', () => {
    const c = bound({ v: field.bigInt64Array({ length: 2 }) }).connector('v');
    expect(c.read()).toBeInstanceOf(BigInt64Array);
    c.write(new BigInt64Array([7n, -9n]));
    expect(Array.from(c.read())).toEqual([7n, -9n]);
  });

  it('boolean connector writes false explicitly', () => {
    const c = bound({ b: field.boolean() }).connector('b');
    c.write(true);
    expect(c.read()).toBe(true);
    c.write(false);
    expect(c.read()).toBe(false);
  });

  it('string connector throws when the encoded value exceeds capacity', () => {
    const c = bound({ s: field.string({ maxBytes: 8 }) }).connector('s');
    expect(() => c.write('x'.repeat(64))).toThrow(/exceeds field capacity/);
  });

  it('structured connector throws when the encoded value exceeds capacity', () => {
    const c = bound({ o: field.object<Record<string, unknown>>({ maxBytes: 16 }) }).connector('o');
    expect(() => c.write({ pad: 'x'.repeat(64) })).toThrow(/exceeds field capacity/);
  });

  it('list connector reads and writes i8, i16, and f32 scalars', () => {
    const mem = bound({ r: field.list({ schema: reef.object({ a: reef.i8(), b: reef.i16(), c: reef.f32() }), count: 2 }) });
    mem.r.writeAt(0, { a: -8, b: -300, c: 1.5 });
    expect(mem.r.readAt(0)).toEqual({ a: -8, b: -300, c: 1.5 });
  });

  it('list readString uses max length when the field is exactly full', () => {
    const mem = bound({ r: field.list({ schema: reef.object({ tag: reef.string(8) }), count: 1 }) });
    mem.r.writeAt(0, { tag: '12345678' }); // fills the field — no zero byte inside max
    expect(mem.r.readAt(0)).toEqual({ tag: '12345678' });
  });

  it('readAt rejects negative indexes', () => {
    const mem = bound({ r: field.list({ schema: reef.object({ v: reef.i32() }), count: 2 }) });
    expect(() => mem.r.readAt(-1)).toThrow(RangeError);
  });

  it('onBound fires immediately when already bound and detaches pre-bind listeners', () => {
    const mem = bound({ n: field.number() });
    let fired = 0;
    mem.onBound(() => fired++);
    expect(fired).toBe(1);

    const unbound = new SharedMemory({ n: field.number() });
    let called = 0;
    const off = unbound.onBound(() => called++);
    off();
    unbound.bind(new SharedArrayBuffer(unbound.totalBytes));
    expect(called).toBe(0);
  });

  it('onBound re-fires on rebind for listeners registered while bound', () => {
    // Rebinds happen in-process (each pool's INIT_MEMORY rebinds every
    // contract) and on worker respawn — a listener added after the first
    // bind must still see later ones, or observes pin a dead buffer.
    const mem = bound({ n: field.number() });
    let fired = 0;
    const off = mem.onBound(() => fired++);
    expect(fired).toBe(1);

    mem.bind(new SharedArrayBuffer(mem.totalBytes));
    expect(fired).toBe(2);

    off();
    mem.bind(new SharedArrayBuffer(mem.totalBytes));
    expect(fired).toBe(2);
  });
});
