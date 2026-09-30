import { describe, expect, it } from 'vitest';
import { z, fluent, SchemaError } from './zod';
import { reef } from './reef';

describe('vendored schema engine', () => {
  it('parses the base kinds and rejects mismatches', () => {
    expect(z.number().parse(1)).toBe(1);
    expect(z.string().parse('a')).toBe('a');
    expect(z.boolean().parse(false)).toBe(false);
    expect(z.bigint().parse(3n)).toBe(3n);
    expect(z.unknown().parse({ any: 'thing' })).toEqual({ any: 'thing' });
    expect(z.instanceof(Uint8Array).parse(new Uint8Array(2))).toBeInstanceOf(Uint8Array);

    for (const [schema, bad, msg] of [
      [z.number(), 'x', 'number'],
      [z.number(), NaN, 'number'],
      [z.string(), 1, 'string'],
      [z.boolean(), 1, 'boolean'],
      [z.bigint(), 1, 'bigint'],
      [z.instanceof(Int32Array), new Uint8Array(1), 'Int32Array'],
    ] as const) {
      expect(() => schema.parse(bad)).toThrow(SchemaError);
      expect(() => schema.parse(bad)).toThrow(new RegExp(`expected ${msg}`));
    }
  });

  it('parses objects memberwise and strips unknown keys', () => {
    const s = z.object({ a: z.number(), b: z.string() });
    expect(s.parse({ a: 1, b: 'x', extra: 'gone' })).toEqual({ a: 1, b: 'x' });
    expect(s.shape.a).toBe(s.shape.a);
    expect(() => s.parse({ a: 'no', b: 'x' })).toThrow(SchemaError);
    expect(() => s.parse('nope')).toThrow(/object/);
    expect(() => s.parse([1, 2])).toThrow(/object/);
  });

  it('parses arrays elementwise', () => {
    const s = z.array(z.number());
    expect(s.parse([1, 2])).toEqual([1, 2]);
    expect(() => s.parse([1, 'x'])).toThrow(SchemaError);
    expect(() => s.parse('nope')).toThrow(/array/);
  });

  it('enforces format-tagged number and bigint ranges', () => {
    expect(z.int32().parse(-2147483648)).toBe(-2147483648);
    expect(() => z.int32().parse(2147483648)).toThrow(/int32/);
    expect(() => z.int32().parse(1.5)).toThrow(/int32/);
    expect(() => z.uint32().parse(-1)).toThrow(/uint32/);
    expect(z.float32().parse(0.5)).toBe(0.5);
    expect(z.float64().parse(Math.PI)).toBe(Math.PI);
    expect(z.int64().parse(-(2n ** 63n))).toBe(-(2n ** 63n));
    expect(() => z.int64().parse(2n ** 63n)).toThrow(/int64/);
    expect(() => z.uint64().parse(-1n)).toThrow(/uint64/);
    expect(z.uint64().parse(2n ** 64n - 1n)).toBe(2n ** 64n - 1n);
  });

  it('evaluates checks with zod-flavored defs and messages', () => {
    expect(() => z.number().check(z.int()).parse(1.5)).toThrow(/integer/);
    expect(() => z.number().check(z.gte(5)).parse(4)).toThrow(/>= 5/);
    expect(() => z.number().check(z.lte(5)).parse(6)).toThrow(/<= 5/);
    expect(() => z.bigint().check(z.nonnegative()).parse(-1n)).toThrow();
    expect(() => z.number().check(z.refine((v) => v === 4)).parse(3)).toThrow(/custom/);
    expect(() => z.array(z.number()).check(z.length(2)).parse([1])).toThrow(/exactly 2 items/);
    expect(() => z.array(z.number()).check(z.maxLength(2)).parse([1, 2, 3])).toThrow(/<=2 items/);
    expect(() => z.array(z.number()).check(z.minLength(2)).parse([1])).toThrow(/>=2 items/);
    // check defs keep the zod vocabulary the layout compiler reads
    const c = z.maxLength(4)._zod.def;
    expect(c).toMatchObject({ check: 'max_length', maximum: 4 });
  });

  it('safeParse returns the tagged union instead of throwing', () => {
    const ok = z.number().safeParse(1);
    expect(ok).toEqual({ success: true, data: 1 });
    const bad = z.number().safeParse('x');
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error).toBeInstanceOf(SchemaError);
  });

  it('.check clones carry meta and keep def.type', () => {
    const s = z.string().register(z.globalRegistry, { bytes: 4 }).check(z.refine((v: string) => v !== ''));
    expect(s._zod.def.type).toBe('string');
    expect(z.globalRegistry.get(s)).toEqual({ bytes: 4 });
    expect(() => s.parse('')).toThrow();
  });

  it('fluent spellings dispatch value vs length bounds', () => {
    expect(() => fluent(z.number()).min(2).parse(1)).toThrow();
    expect(() => fluent(z.number()).max(2).parse(3)).toThrow();
    expect(() => fluent(z.array(z.number())).min(2).parse([1])).toThrow(/>=2/);
    expect(() => fluent(z.string()).length(2).parse('abc')).toThrow(/exactly 2/);
    expect(fluent(z.string()).meta({ bytes: 2 }).meta()).toEqual({ bytes: 2 });
    // fluent attaches non-enumerable members — def surface stays clean
    const s = reef.u8();
    expect(Object.keys(s._zod.def)).not.toContain('refine');
  });
});
