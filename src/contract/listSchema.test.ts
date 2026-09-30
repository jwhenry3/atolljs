import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import { listSchema, memberToSpec } from './listSchema';

const fullSpec = {
  i8v: 'i8', u8v: 'u8', i16v: 'i16', u16v: 'u16', i32v: 'i32', u32v: 'u32',
  f32v: 'f32', f64v: 'f64', i64v: 'i64', u64v: 'u64',
  tag: { string: 4 },
} as const;

const valid = {
  i8v: -128, u8v: 255, i16v: -32768, u16v: 65535, i32v: -2147483648, u32v: 4294967295,
  f32v: 1.5, f64v: -2.25, i64v: -1n, u64v: 9007199254740993n,
  tag: 'abcd',
};

describe('listSchema', () => {
  const schema = listSchema(fullSpec);

  it('accepts values at every storage bound', () => {
    expect(schema.parse(valid)).toEqual(valid);
  });

  it('maps i64/u64 to bigint and enforces u64 non-negativity', () => {
    expect(() => schema.parse({ ...valid, u64v: -1n })).toThrow();
    expect(() => schema.parse({ ...valid, u64v: 5 })).toThrow(); // number ≠ bigint
    expect(() => schema.parse({ ...valid, i64v: 5 })).toThrow();
  });

  it('rejects non-integer numbers for integer kinds', () => {
    expect(() => schema.parse({ ...valid, u16v: 1.5 })).toThrow();
  });

  it('accepts fractional values for f32/f64', () => {
    expect(() => schema.parse({ ...valid, f32v: 0.1, f64v: Math.PI })).not.toThrow();
  });

  it('checks inline strings by UTF-8 byte length, not char count', () => {
    expect(() => schema.parse({ ...valid, tag: 'abcde' })).toThrow(); // 5 bytes > 4
    // '€' is 3 UTF-8 bytes — fits exactly in 4, '€€' is 6
    expect(schema.parse({ ...valid, tag: '€' }).tag).toBe('€');
    expect(() => schema.parse({ ...valid, tag: '€€' })).toThrow();
  });

  it('produces a ZodObject usable with z.infer for record types', () => {
    type Row = z.infer<typeof schema>;
    const row: Row = schema.parse(valid);
    expect(row.u8v).toBe(255);
  });

  it('accepts raw zod-mini members, enforcing their declared bounds', () => {
    // real mini schemas introspect via _zod.def like ours do
    const mini = listSchema({ n: zm.uint32(), f: zm.float64() });
    expect(mini.parse({ n: 4294967295, f: 0.5 })).toEqual({ n: 4294967295, f: 0.5 });
    expect(() => mini.parse({ n: -1, f: 0 })).toThrow();
    expect(() => mini.parse({ n: 0, f: 'x' })).toThrow();
  });

  it('reads the byte budget from classic .meta(); mini strings can\'t carry it', () => {
    // classic zod's .meta() is readable; mini has no .meta — reef.string is
    // the byte-budgeted spelling there, a bare mini string rejects at layout.
    const classic = listSchema({ tag: z.string().meta({ bytes: 4 }) });
    expect(classic.parse({ tag: '€' }).tag).toBe('€');
    expect(() => classic.parse({ tag: 'abcde' })).toThrow();
    expect(() => memberToSpec(zm.string(), 'tag')).toThrow(/meta\(\{ bytes: n \}\)/);
  });
});
