import { describe, expect, it } from 'vitest';
import { jsonCodec, type Codec } from './sharedMemory';
import { msgpackrCodec } from './msgpackrCodec';

const sample = {
  id: 42,
  name: 'nåme ünïcode ✓',
  nested: { a: [1, 2, 3], b: { c: 'deep' } },
  flags: [true, false],
  nothing: null,
};

const roundTrip = (codec: Codec, value: unknown) => codec.decode(codec.encode(value));

const ALL_CODECS: Array<[string, Codec]> = [
  ['json', jsonCodec],
  ['msgpackr', msgpackrCodec],
];

describe.each(ALL_CODECS)('%s codec', (_name, codec) => {
  it('round-trips nested objects and arrays', () => {
    expect(roundTrip(codec, sample)).toEqual(sample);
  });

  it('round-trips arrays of uniform records without corruption', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, sym: `X${i % 5}`, px: i * 1.5 }));
    expect(roundTrip(codec, rows)).toEqual(rows);
  });

  it('round-trips primitives', () => {
    expect(roundTrip(codec, 'str')).toBe('str');
    expect(roundTrip(codec, 3.14)).toBe(3.14);
    expect(roundTrip(codec, true)).toBe(true);
  });
});

describe('msgpackr codec (binary)', () => {
  it('preserves binary payloads', () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    const decoded = roundTrip(msgpackrCodec, { bytes }) as { bytes: ArrayLike<number> };
    expect(Array.from(decoded.bytes)).toEqual([1, 2, 3, 255]);
  });

  it('is byte-compact vs JSON for uniform records', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, sym: 'AAPL', px: i }));
    const json = jsonCodec.encode(rows).byteLength;
    expect(msgpackrCodec.encode(rows).byteLength).toBeLessThan(json);
  });

  it('preserves bigint', () => {
    expect(roundTrip(msgpackrCodec, { big: 9007199254740993n })).toEqual({ big: 9007199254740993n });
  });

  it('record-sharing survives many same-shape objects', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ sym: 'MSFT', px: i, qty: i * 2 }));
    const out = roundTrip(msgpackrCodec, rows) as typeof rows;
    expect(out[199]).toEqual({ sym: 'MSFT', px: 199, qty: 398 });
    expect(out).toEqual(rows);
  });
});

describe('codec failure modes', () => {
  it('jsonCodec throws on malformed input', () => {
    expect(() => jsonCodec.decode(new TextEncoder().encode('{nope'))).toThrow();
  });

  it('msgpackrCodec throws on garbage bytes', () => {
    const junk = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]);
    expect(() => msgpackrCodec.decode(junk)).toThrow();
  });
});
