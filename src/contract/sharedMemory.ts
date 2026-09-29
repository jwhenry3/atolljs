import type { Prettify, Schema } from './types';
import { msgpackrCodec } from './msgpackrCodec';
import { memberToSpec, zodArrayInfo, zodObjectShape, zodStringBytes } from './listSchema';
import { fmtBytes, scoped } from '../log';
import { z } from 'zod';

const memLog = scoped('memory');

const ALIGNMENT = 8;
const alignTo = (value: number, alignment: number) => (value + alignment - 1) & ~(alignment - 1);
const align = (bytes: number) => alignTo(bytes, ALIGNMENT);

/**
 * Declares the datatype of a single field in the shared memory contract.
 * `byteLength` is the fixed region reserved for the field; structured types
 * (string, object, array) carry a 4-byte length header inside that region.
 */
export interface FieldDescriptor<T = unknown> {
  readonly kind: string;
  readonly byteLength: number;
  readonly schema?: Schema<T>;
  readonly __fieldType?: T;
}

/**
 * A group of fields under one intent — any plain-object member of the spec
 * that isn't a descriptor. Group names are the user's vocabulary:
 * `lists`, `state`, `signals`, `telemetry` — one level deep.
 */
export type FieldGroup = Record<string, FieldDescriptor>;

export type SharedSpec = Record<string, FieldDescriptor | FieldGroup>;

/** Spec keys that hold a descriptor directly (not an intent group). */
export type FlatKey<S extends SharedSpec> = {
  [K in keyof S]: S[K] extends FieldDescriptor ? K : never;
}[keyof S];

/**
 * Every legal field path of a spec — flat fields give their key (`metrics`),
 * grouped fields give `group.field` (`signals.seedProgress`).
 */
export type SpecPath<S extends SharedSpec> = {
  [K in keyof S & string]: S[K] extends FieldGroup
    ? `${K}.${keyof S[K] & string}`
    : K;
}[keyof S & string];

const isDescriptor = (v: unknown): v is FieldDescriptor =>
  typeof v === 'object' && v !== null &&
  typeof (v as FieldDescriptor).kind === 'string' &&
  typeof (v as FieldDescriptor).byteLength === 'number';

interface FieldEntry {
  /** Dotted path — `incidents` for flat fields, `lists.incidents` grouped. */
  path: string;
  descriptor: FieldDescriptor;
}

function flattenSpec(spec: SharedSpec): FieldEntry[] {
  const entries: FieldEntry[] = [];
  for (const [key, value] of Object.entries(spec)) {
    if (isDescriptor(value)) {
      entries.push({ path: key, descriptor: value });
    } else {
      for (const [member, descriptor] of Object.entries(value)) {
        if (!isDescriptor(descriptor)) {
          throw new TypeError(
            `shared memory "${key}.${member}" is not a field descriptor — intent groups nest one level only`
          );
        }
        entries.push({ path: `${key}.${member}`, descriptor });
      }
    }
  }
  return entries;
}

/**
 * Serializer for structured (object/array) fields. Both threads must use the
 * same codec — it comes from the shared contract definition, so it does.
 */
export interface Codec {
  encode(value: unknown): Uint8Array;
  decode(data: Uint8Array): unknown;
}

const codecTextEncoder = new TextEncoder();
const codecTextDecoder = new TextDecoder();

export const jsonCodec: Codec = {
  encode: (value) => codecTextEncoder.encode(JSON.stringify(value)),
  decode: (data) => JSON.parse(codecTextDecoder.decode(data)),
};

/**
 * Context handed to connector factories at bind time.
 */
export interface ConnectorContext {
  buffer: SharedArrayBuffer;
  codec: Codec;
  /** Slot in the shared version counter — bump + notify on granular writes. */
  version?: { view: Int32Array; index: number };
}

/**
 * A connector factory builds a connector for one field kind over a region of
 * the shared buffer. Factories are the plugin unit of the SDK: register new
 * kinds globally via `registerConnectorFactory` or override per contract via
 * `SharedMemoryOptions.plugins`.
 */
export type ConnectorFactory = (
  descriptor: FieldDescriptor,
  ctx: ConnectorContext,
  byteOffset: number
) => Connector<any>;

const CONNECTOR_FACTORIES = new Map<string, ConnectorFactory>();

/** Registers (or overrides) the connector factory for a field kind, SDK-wide. */
export function registerConnectorFactory(kind: string, factory: ConnectorFactory): void {
  CONNECTOR_FACTORIES.set(kind, factory);
}

export interface SharedMemoryOptions {
  codec?: Codec; // defaults to msgpackrCodec
  plugins?: Record<string, ConnectorFactory>; // per-contract factory overrides, keyed by field kind
}

/** The element type a field descriptor holds — `InferField<typeof memory.spec.x>`. */
export type InferField<D> = D extends FieldDescriptor<infer T> ? T : unknown;

/**
 * A bound connector reads and writes a single field of the shared memory
 * contract. Both threads hold an identical connector for each field.
 */
export interface Connector<T> {
  readonly byteOffset: number;
  readonly byteLength: number;
  read(): T;
  write(value: T): void;
  /** Internal: slot in the shared version counter block, bumped on every write. */
  readonly _version?: { view: Int32Array; index: number };
}

/* ------------------------------------------------------------------ */
/* Fixed-layout list fields — zero serialization                     */
/* ------------------------------------------------------------------ */

export type ScalarKind = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64' | 'i64' | 'u64';

/** A fixed-layout member spec: a scalar kind, `{ string: n }` for an inline UTF-8 field of n bytes, or `{ bool: true }` for a flag byte. */
export type ListFieldSpec = ScalarKind | { string: number } | { bool: true };
export type ListSpec = Record<string, ListFieldSpec>;

/**
 * A fixed-width member inside a record or element position — a binary spec
 * token (`'u32'`, `{ string: n }`, `{ bool: true }`) or a zod schema that
 * expresses the same thing (`mz.u32()`, `mz.int(0, 3)`, `mz.string(n)`).
 * Schemas are compiled to tokens for layout and kept as the field's
 * validation schema — one declaration.
 */
export type ListMember = ListFieldSpec | z.ZodTypeAny;
export type ListFields = Record<string, ListMember>;

/** The plain-object shape of one record in a list field — `z.output` of the declared record schema. */
export type ListRecord<S extends z.ZodObject> = z.output<S>;

export interface ListDescriptor<S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>>
  extends Omit<FieldDescriptor<ListRecord<S>[]>, 'schema'> {
  readonly kind: 'list';
  /**
   * The declared record schema — an `mz.object` of fixed-width members. It
   * IS the layout source AND the record validator (`schemas.lists.x` is this
   * same object). Note it parses one record, not the whole array.
   */
  readonly schema: S;
  /** The compiled binary spec per member — always scalar tokens/`{string:n}`/`{bool}`. */
  readonly layout: Record<keyof z.output<S> & string, ListFieldSpec>;
  readonly offsets: Record<keyof z.output<S> & string, number>;
  readonly recordSize: number;
  readonly count: number;
}

/**
 * A connector over a fixed-layout record array. `readAt`/`writeAt` access a
 * single record directly via DataView — no encode/decode pass, ever.
 * `readAt(index, out)` reuses `out` for allocation-free scans.
 */
export interface ListConnector<R> extends Connector<R[]> {
  readonly recordCount: number;
  readonly recordSize: number;
  readAt(index: number): R;
  /** Read into `out`; pass `fields` to read a subset (skips e.g. inline strings). */
  readAt(index: number, out: Partial<R>, fields?: (keyof R)[]): R;
  writeAt(index: number, record: R): void;
  /** Write only the listed fields — partial updates leave other fields untouched. */
  writeAt(index: number, record: Partial<R>, fields: (keyof R)[]): void;
  /**
   * Bump the field version counter and wake remote observers. `writeAt` is
   * intentionally pure memory access — call commit() after a batch of writes
   * to propagate them (bursts coalesce to latest anyway).
   */
  commit(): void;
}

type AccessMember<V> =
  V extends FieldDescriptor
    ? V extends ListDescriptor<infer S>
      ? ListConnector<ListRecord<S>>
      : Connector<InferField<V>>
    : V extends FieldGroup
      ? Prettify<SharedAccess<V>>
      : never;

export type SharedAccess<S extends SharedSpec> = {
  [K in keyof S]: AccessMember<S[K]>;
};

/**
 * The connector a `SpecPath` resolves to — `PathConnector<S, 'state.metrics'>`
 * digs through the intent group to the member's connector.
 */
export type PathConnector<S extends SharedSpec, P> =
  P extends `${infer G}.${infer F}`
    ? S[G] extends FieldGroup
      ? F extends keyof S[G] ? AccessMember<S[G][F]> : never
      : never
    : P extends keyof S ? AccessMember<S[P]> : never;

const SCALAR_SIZES: Record<ScalarKind, number> = {
  i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8, i64: 8, u64: 8,
};

const listFieldSize = (spec: ListFieldSpec) => (typeof spec === 'string' ? SCALAR_SIZES[spec] : 'string' in spec ? spec.string : 1);
const listFieldAlign = (spec: ListFieldSpec) => (typeof spec === 'string' ? SCALAR_SIZES[spec] : 1);

/**
 * Compiles a declared member map to its binary layout — spec tokens per
 * member, byte offsets, and the aligned record size. Shared by `field.list`
 * and the schema-driven `field.object`/`field.array` derivations.
 */
function compileListLayout<F extends ListFields>(fields: F): {
  layout: Record<keyof F, ListFieldSpec>;
  offsets: Record<keyof F, number>;
  recordSize: number;
} {
  const offsets = {} as Record<keyof F, number>;
  const layout = {} as Record<keyof F, ListFieldSpec>;
  let offset = 0;
  for (const key of Object.keys(fields) as (keyof F)[]) {
    const spec = memberToSpec(fields[key], String(key));
    layout[key] = spec;
    offset = alignTo(offset, listFieldAlign(spec));
    offsets[key] = offset;
    offset += listFieldSize(spec);
  }
  return { layout, offsets, recordSize: align(offset) };
}

/**
 * A `field.object({ schema })` whose zod members compiled to an inline fixed
 * layout — an 8-byte header (`written` flag + reserved) plus one record.
 * `maxBytes` never appears: the byte width IS the schema.
 */
export interface FixedObjectDescriptor<T = unknown> extends FieldDescriptor<T> {
  readonly kind: 'object';
  readonly schema: Schema<T>;
  /** The compiled binary spec per member — always scalar tokens/`{string:n}`/`{bool}`. */
  readonly layout: Record<string, ListFieldSpec>;
  readonly offsets: Record<string, number>;
  readonly recordSize: number;
}

/**
 * A `field.array({ schema })` whose bounded zod array compiled to an inline
 * layout — an 8-byte header (`written` flag + element count) plus `capacity`
 * fixed-stride elements.
 */
export interface FixedArrayDescriptor<T = unknown> extends FieldDescriptor<T[]> {
  readonly kind: 'array';
  readonly schema: Schema<T[]>;
  /** The compiled element spec — scalar token, `{string:n}`, or `{bool}`. */
  readonly element: ListFieldSpec;
  /** Bytes per element, aligned. */
  readonly elementStride: number;
  readonly capacity: number;
}

interface ObjectFieldFactory {
  /**
   * Inline fixed layout — the schema is a zod object of fixed-width members
   * (`mz` helpers, `z.uint32()`, bounded ints, `mz.string(n)`, `z.boolean()`);
   * `byteLength` derives from the member widths. Compile fails loudly for
   * members with no fixed width (unbounded strings, nested objects).
   */
  <S extends z.ZodObject<z.ZodRawShape>>(options: { schema: S }): FixedObjectDescriptor<z.output<S>>;
  /** Codec-encoded blob — explicit byte budget for arbitrary payloads. */
  <T = unknown>(options: { maxBytes: number; schema?: Schema<T> }): FieldDescriptor<T>;
  /** Schema with no derivable width — rejected at construction. */
  <T = unknown>(options: { schema: Schema<T> }): FieldDescriptor<T>;
}

const objectFieldImpl: ObjectFieldFactory = (options: { schema?: Schema<unknown>; maxBytes?: number }): any => {
  const { schema, maxBytes } = options;
  if (maxBytes === undefined && schema) {
    const shape = zodObjectShape(schema);
    if (shape) {
      const { layout, offsets, recordSize } = compileListLayout(shape);
      return { kind: 'object', byteLength: 8 + recordSize, schema, layout, offsets, recordSize };
    }
    throw new TypeError(
      `field.object: schema can't derive a fixed byte width (not a zod object of fixed-width members) — pass { maxBytes } for codec-encoded storage`
    );
  }
  if (maxBytes === undefined) {
    throw new TypeError(`field.object: pass { schema } for a fixed-layout field or { maxBytes } for a codec-encoded field`);
  }
  return { kind: 'object', byteLength: 4 + maxBytes, schema };
};

interface ArrayFieldFactory {
  /**
   * Inline fixed layout — the schema is a bounded zod array
   * (`mz.array(mz.u32()).max(n)`, `.length(n)`); `byteLength` derives from
   * the element width × the bound. Elements must be fixed-width members
   * (scalars, `mz.string(n)`, booleans) — use `field.list` for record arrays.
   */
  <S extends z.ZodArray>(options: { schema: S }): FixedArrayDescriptor<S extends z.ZodArray<infer E> ? z.output<E> : unknown>;
  /** Codec-encoded blob — explicit byte budget for arbitrary payloads. */
  <T = unknown>(options: { maxBytes: number; schema?: Schema<T[]> }): FieldDescriptor<T[]>;
  /** Schema with no derivable width — rejected at construction. */
  <T = unknown>(options: { schema: Schema<T[]> }): FieldDescriptor<T[]>;
}

const arrayFieldImpl: ArrayFieldFactory = (options: { schema?: Schema<unknown>; maxBytes?: number }): any => {
  const { schema, maxBytes } = options;
  if (maxBytes === undefined && schema) {
    const info = zodArrayInfo(schema);
    if (info) {
      if (info.capacity === null) {
        throw new TypeError(`field.array: z.array() needs .max(n) or .length(n) — bounded arrays are fixed-width`);
      }
      let element: ListFieldSpec;
      try {
        element = memberToSpec(info.element as ListMember, 'array element');
      } catch (e) {
        throw new TypeError(`field.array: element isn't a fixed-width member — use field.list for arrays of records (${(e as Error).message})`);
      }
      const elementStride = alignTo(listFieldSize(element), listFieldAlign(element));
      return { kind: 'array', byteLength: 8 + info.capacity * elementStride, schema, element, elementStride, capacity: info.capacity };
    }
    throw new TypeError(
      `field.array: schema can't derive a fixed byte width (not a bounded zod array) — pass { maxBytes } for codec-encoded storage`
    );
  }
  if (maxBytes === undefined) {
    throw new TypeError(`field.array: pass { schema } for a fixed-layout field or { maxBytes } for a codec-encoded field`);
  }
  return { kind: 'array', byteLength: 4 + maxBytes, schema };
};

interface StringFieldFactory {
  /** Explicit byte budget — 4-byte length header + up to `maxBytes` of UTF-8. */
  (options: { maxBytes: number; schema?: Schema<string> }): FieldDescriptor<string>;
  /** Budget derived from the schema — `mz.string(n)` / `z.string().meta({ bytes: n })`. */
  (options: { schema: Schema<string> }): FieldDescriptor<string>;
}

const stringFieldImpl: StringFieldFactory = (options: { schema?: Schema<string>; maxBytes?: number }): any => {
  const { schema, maxBytes } = options;
  if (maxBytes !== undefined) return { kind: 'string', byteLength: 4 + maxBytes, schema };
  const bytes = schema ? zodStringBytes(schema) : null;
  if (bytes !== null) return { kind: 'string', byteLength: 4 + bytes, schema };
  throw new TypeError(
    `field.string: pass { maxBytes } or a schema carrying a byte budget — mz.string(n) / z.string().meta({ bytes: n })`
  );
};

/**
 * Field datatype helpers for `defineSharedMemory`.
 */
export const field = {
  number: (): FieldDescriptor<number> => ({ kind: 'number', byteLength: 8 }),
  boolean: (): FieldDescriptor<boolean> => ({ kind: 'boolean', byteLength: 8 }),
  string: stringFieldImpl,
  object: objectFieldImpl,
  array: arrayFieldImpl,
  int32Array: ({ length }: { length: number }): FieldDescriptor<Int32Array> => ({ kind: 'Int32', byteLength: length * 4 }),
  float64Array: ({ length }: { length: number }): FieldDescriptor<Float64Array> => ({ kind: 'Float64', byteLength: length * 8 }),
  bigInt64Array: ({ length }: { length: number }): FieldDescriptor<BigInt64Array> => ({ kind: 'BigInt64', byteLength: length * 8 }),
  uint8Array: ({ length }: { length: number }): FieldDescriptor<Uint8Array> => ({ kind: 'Uint8', byteLength: length }),
  /**
   * A fixed-layout array of `count` records. `schema` is an `mz.object` of
   * fixed-width members (`mz.u32()`, `mz.int(0, 3)`, `mz.string(n)`,
   * `mz.boolean()`) — the same schema `field.object` takes, repeated `count`
   * times. Every record occupies `recordSize` bytes at a computable offset:
   * reads and writes are direct memory access, no serialization.
   */
  list: <S extends z.ZodObject<z.ZodRawShape>>({ schema, count }: { schema: S; count: number }): ListDescriptor<S> => {
    const shape = zodObjectShape(schema);
    if (!shape) {
      throw new TypeError(`field.list: schema must be an mz.object() of fixed-width members`);
    }
    const { layout, offsets, recordSize } = compileListLayout(shape);
    return {
      kind: 'list',
      byteLength: recordSize * count,
      schema,
      layout,
      offsets,
      recordSize,
      count,
    };
  },
};

type TypedArrayConstructor = {
  new (buffer: SharedArrayBuffer, byteOffset: number, length: number): Int32Array | Float64Array | BigInt64Array | Uint8Array;
  readonly BYTES_PER_ELEMENT: number;
};

const TYPED_ARRAYS: Record<string, TypedArrayConstructor> = {
  Int32: Int32Array,
  Float64: Float64Array,
  BigInt64: BigInt64Array,
  Uint8: Uint8Array,
};

/* ------------------------------------------------------------------ */
/* Built-in connector factories (the default plugins)                  */
/* ------------------------------------------------------------------ */

registerConnectorFactory('number', (d, ctx, byteOffset) => {
  const view = new Float64Array(ctx.buffer, byteOffset, 1);
  return { byteOffset, byteLength: d.byteLength, read: () => view[0], write: (v) => { view[0] = v; } };
});

registerConnectorFactory('boolean', (d, ctx, byteOffset) => {
  const view = new Uint8Array(ctx.buffer, byteOffset, 1);
  return { byteOffset, byteLength: d.byteLength, read: () => view[0] === 1, write: (v) => { view[0] = v ? 1 : 0; } };
});

for (const kind of Object.keys(TYPED_ARRAYS)) {
  registerConnectorFactory(kind, (d, ctx, byteOffset) => {
    const Ctor = TYPED_ARRAYS[kind];
    const view = new Ctor(ctx.buffer, byteOffset, d.byteLength / Ctor.BYTES_PER_ELEMENT);
    // read() returns the live view — zero-copy on both threads
    return { byteOffset, byteLength: d.byteLength, read: () => view, write: (v) => view.set(v) };
  });
}

registerConnectorFactory('string', (d, ctx, byteOffset) => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const capacity = d.byteLength - 4;
  const lengthView = new Uint32Array(ctx.buffer, byteOffset, 1);
  const writeBytes = (bytes: Uint8Array) => {
    if (bytes.byteLength > capacity) {
      throw new Error(`Encoded value of ${bytes.byteLength} bytes exceeds field capacity of ${capacity} bytes at offset ${byteOffset}`);
    }
    lengthView[0] = bytes.byteLength;
    new Uint8Array(ctx.buffer, byteOffset + 4, bytes.byteLength).set(bytes);
  };
  // slice() copies out of the SharedArrayBuffer — TextDecoder.decode
  // rejects shared views in browsers.
  const readBytes = () => new Uint8Array(ctx.buffer, byteOffset + 4, lengthView[0]).slice();
  return {
    byteOffset,
    byteLength: d.byteLength,
    read: () => decoder.decode(readBytes()),
    write: (v: string) => writeBytes(encoder.encode(d.schema ? (d.schema.parse(v) as string) : v)),
  };
});

type ScalarIO = { get(offset: number): number | bigint; set(offset: number, value: number | bigint): void };

/**
 * Shared primitive IO over the bound buffer — scalar DataView accessors,
 * inline string read/write, and `{ bool }` flags. `ops` resolves a member
 * spec to direct closures once, so hot paths never re-dispatch per record.
 */
function makeIO(ctx: ConnectorContext) {
  const view = new DataView(ctx.buffer);
  const byteView = new Uint8Array(ctx.buffer); // one view — avoids per-call view allocs
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const scalarIO: Record<ScalarKind, ScalarIO> = {
    i8: { get: (o) => view.getInt8(o), set: (o, v) => view.setInt8(o, v as number) },
    u8: { get: (o) => view.getUint8(o), set: (o, v) => view.setUint8(o, v as number) },
    i16: { get: (o) => view.getInt16(o), set: (o, v) => view.setInt16(o, v as number) },
    u16: { get: (o) => view.getUint16(o), set: (o, v) => view.setUint16(o, v as number) },
    i32: { get: (o) => view.getInt32(o), set: (o, v) => view.setInt32(o, v as number) },
    u32: { get: (o) => view.getUint32(o), set: (o, v) => view.setUint32(o, v as number) },
    f32: { get: (o) => view.getFloat32(o), set: (o, v) => view.setFloat32(o, v as number) },
    f64: { get: (o) => view.getFloat64(o), set: (o, v) => view.setFloat64(o, v as number) },
    i64: { get: (o) => view.getBigInt64(o), set: (o, v) => view.setBigInt64(o, v as bigint) },
    u64: { get: (o) => view.getBigUint64(o), set: (o, v) => view.setBigUint64(o, v as bigint) },
  };

  const readString = (offset: number, max: number): string => {
    const zero = byteView.indexOf(0, offset);
    const len = zero === -1 || zero - offset >= max ? max : zero - offset;
    return decoder.decode(byteView.slice(offset, offset + len)); // slice() — non-shared copy for decode
  };

  // encodeInto can't target shared views in browsers — encode into a scratch
  // buffer (grown to the widest inline string encountered), then copy.
  let scratch = new Uint8Array(64);
  const writeString = (offset: number, max: number, value: string) => {
    if (scratch.length < max) scratch = new Uint8Array(max);
    const { read, written } = encoder.encodeInto(value, scratch);
    if (read < value.length || written > max) {
      throw new Error(`String exceeds inline field capacity of ${max} bytes`);
    }
    byteView.set(scratch.subarray(0, written), offset);
    if (written < max) byteView.fill(0, offset + written, offset + max);
  };

  /** Resolves a member spec to direct get/set closures — dispatch happens once. */
  const ops = (spec: ListFieldSpec): { get(offset: number): unknown; set(offset: number, value: unknown): void } => {
    if (typeof spec === 'string') {
      const io = scalarIO[spec];
      return { get: (o) => io.get(o), set: (o, v) => io.set(o, v as number | bigint) };
    }
    if ('bool' in spec) {
      return { get: (o) => !!view.getUint8(o), set: (o, v) => view.setUint8(o, v ? 1 : 0) };
    }
    return { get: (o) => readString(o, spec.string), set: (o, v) => writeString(o, spec.string, v as string) };
  };

  /** Precompiled record accessors over a member layout — shared by list and fixed-object connectors. */
  const compile = (layout: Record<string, ListFieldSpec>, offsets: Record<string, number>) => {
    const readers = new Map<string, (base: number, out: Record<string, unknown>) => void>();
    const writers = new Map<string, (base: number, record: Record<string, unknown>) => void>();
    for (const key of Object.keys(layout)) {
      const { get, set } = ops(layout[key]);
      const rel = offsets[key];
      readers.set(key, (base, out) => { out[key] = get(base + rel); });
      writers.set(key, (base, record) => set(base + rel, record[key]));
    }
    const allReaders = [...readers.values()];
    const allWriters = [...writers.values()];
    return {
      read(base: number, out: Record<string, unknown> = {}, fieldNames?: string[]) {
        if (fieldNames) {
          for (const key of fieldNames) readers.get(key)!(base, out);
        } else {
          for (const read of allReaders) read(base, out);
        }
        return out;
      },
      write(base: number, record: Record<string, unknown>, fieldNames?: string[]) {
        if (fieldNames) {
          for (const key of fieldNames) writers.get(key)!(base, record);
        } else {
          for (const write of allWriters) write(base, record);
        }
      },
    };
  };

  return { ops, compile };
}

const structuredFactory: ConnectorFactory = (d, ctx, byteOffset) => {
  const { schema, byteLength, kind } = d;
  const fixed = d as Partial<FixedObjectDescriptor> & Partial<FixedArrayDescriptor>;

  // Schema-derived fixed layouts — no codec, width comes from the schema.
  // 8-byte header: [u32 written flag][u32 aux] then the inline payload.
  if (fixed.layout && fixed.offsets && fixed.recordSize !== undefined) {
    const flag = new Uint32Array(ctx.buffer, byteOffset, 2);
    const base = byteOffset + 8;
    const record = makeIO(ctx).compile(fixed.layout, fixed.offsets);
    return {
      byteOffset,
      byteLength,
      read: () => (flag[0] ? record.read(base, {}) : undefined), // unwritten on either thread
      write: (v) => {
        record.write(base, (schema ? schema.parse(v) : v) as Record<string, unknown>);
        flag[0] = 1; // flag last — a racing reader must never see it mid-record
      },
    };
  }
  if (fixed.element !== undefined && fixed.elementStride !== undefined && fixed.capacity !== undefined) {
    const flag = new Uint32Array(ctx.buffer, byteOffset, 1);
    const count = new Uint32Array(ctx.buffer, byteOffset + 4, 1);
    const el = makeIO(ctx).ops(fixed.element);
    const stride = fixed.elementStride;
    const capacity = fixed.capacity;
    const base = byteOffset + 8;
    return {
      byteOffset,
      byteLength,
      read: () => {
        if (!flag[0]) return undefined;
        const n = count[0];
        return Array.from({ length: n }, (_, i) => el.get(base + i * stride));
      },
      write: (v: unknown[]) => {
        const parsed = (schema ? schema.parse(v) : v) as unknown[];
        if (parsed.length > capacity) {
          throw new Error(`${parsed.length} elements exceeds array capacity of ${capacity}`);
        }
        parsed.forEach((v, i) => el.set(base + i * stride, v));
        count[0] = parsed.length;
        flag[0] = 1; // flag last — same mid-write guarantee as the object path
      },
    };
  }

  const capacity = byteLength - 4;
  const lengthView = new Uint32Array(ctx.buffer, byteOffset, 1);
  const writeBytes = (bytes: Uint8Array) => {
    if (bytes.byteLength > capacity) {
      throw new Error(`Encoded value of ${bytes.byteLength} bytes exceeds field capacity of ${capacity} bytes at offset ${byteOffset}`);
    }
    lengthView[0] = bytes.byteLength;
    new Uint8Array(ctx.buffer, byteOffset + 4, bytes.byteLength).set(bytes);
  };
  // slice() copies out of the SharedArrayBuffer — TextDecoder.decode
  // rejects shared views in browsers.
  const readBytes = () => new Uint8Array(ctx.buffer, byteOffset + 4, lengthView[0]).slice();
  return {
    byteOffset,
    byteLength,
    read: () => {
      const bytes = readBytes();
      if (bytes.byteLength === 0) return undefined; // not yet written on either thread
      const value = ctx.codec.decode(bytes);
      return schema ? schema.parse(value) : value;
    },
    write: (v) => writeBytes(ctx.codec.encode(schema ? schema.parse(v) : v)),
  };
};

registerConnectorFactory('object', structuredFactory);
registerConnectorFactory('array', structuredFactory);

function listFactory(d: FieldDescriptor, ctx: ConnectorContext, byteOffset: number): ListConnector<any> {
  const info = d as ListDescriptor;
  const { offsets, recordSize, count } = info;
  // `layout` is the compiled token map; `schema` stays the validation schema.
  const record = makeIO(ctx).compile(info.layout, offsets);

  const checkIndex = (index: number) => {
    if (index < 0 || index >= count) {
      throw new RangeError(`Record index ${index} out of bounds (0..${count - 1})`);
    }
  };

  const readAt = (index: number, out: Record<string, unknown> = {}, fieldNames?: string[]) => {
    checkIndex(index);
    return record.read(byteOffset + index * recordSize, out, fieldNames);
  };

  const writeAt = (index: number, rec: Record<string, unknown>, fieldNames?: string[]) => {
    checkIndex(index);
    record.write(byteOffset + index * recordSize, rec, fieldNames);
  };

  const connector: ListConnector<any> = {
    byteOffset,
    byteLength: d.byteLength,
    recordCount: count,
    recordSize,
    readAt: readAt as ListConnector<any>['readAt'],
    writeAt: writeAt as ListConnector<any>['writeAt'],
    commit: () => {
      if (ctx.version) {
        Atomics.add(ctx.version.view, ctx.version.index, 1);
        // Wake EVERY waitAsync observer — several watchers may share this
        // field's counter; a bounded notify starves all but one.
        Atomics.notify(ctx.version.view, ctx.version.index);
      }
    },
    read: () => Array.from({ length: count }, (_, i) => readAt(i)),
    write: (records: any[]) => {
      if (records.length > count) {
        throw new Error(`${records.length} records exceeds list array capacity of ${count}`);
      }
      records.forEach((r, i) => writeAt(i, r));
    },
  };
  return connector;
}

registerConnectorFactory('list', listFactory);

/* ------------------------------------------------------------------ */

const definedSharedMemories: SharedMemory<any>[] = [];

/**
 * The zod schema for a field's logical unit: the declared `schema` for
 * object/array/list fields (for lists, the record schema), and a derived
 * scalar/typed-array schema for everything else.
 */
export type FieldSchema<D> =
  'schema' extends keyof D
    ? NonNullable<D['schema']>
    : z.ZodType<InferField<D>>;

/**
 * A zod schema per field — `memory.schemas.<field>` re-exports what the spec
 * declared inline. Intent groups mirror their spec shape:
 * `memory.schemas.lists.incidents` is the record schema.
 */
type SchemaMember<V> =
  V extends FieldDescriptor
    ? FieldSchema<V>
    : V extends FieldGroup
      ? Prettify<SpecSchemas<V>>
      : never;

export type SpecSchemas<S extends SharedSpec> = {
  [K in keyof S]: SchemaMember<S[K]>;
};

/** Mirrors the spec's intent groups — schemas nest exactly where the fields do. */
function buildSchemas<S extends SharedSpec>(spec: S): SpecSchemas<S> {
  const schemas: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec)) {
    schemas[key] = isDescriptor(value)
      ? fieldSchemaOf(value)
      : Object.fromEntries(Object.entries(value).map(([m, d]) => [m, fieldSchemaOf(d)]));
  }
  return schemas as SpecSchemas<S>;
}

function fieldSchemaOf(descriptor: FieldDescriptor): Schema<unknown> {
  if (descriptor.schema) return descriptor.schema;
  switch (descriptor.kind) {
    case 'number': return z.number();
    case 'boolean': return z.boolean();
    case 'string': return z.string();
    case 'Int32': return z.instanceof(Int32Array);
    case 'Float64': return z.instanceof(Float64Array);
    case 'BigInt64': return z.instanceof(BigInt64Array);
    case 'Uint8': return z.instanceof(Uint8Array);
    default: return z.unknown();
  }
}

/**
 * A shared memory contract: a fixed, deterministic layout of typed fields over
 * a SharedArrayBuffer. Both threads import the same contract object; the pool
 * binds it on the main thread and the worker bootstrap binds it inside workers,
 * guaranteeing identical memory usage on both sides.
 */
export class SharedMemory<S extends SharedSpec = SharedSpec> {
  public readonly totalBytes: number;
  /** The field descriptors the contract was defined with — the inline spec. */
  public readonly spec: S;
  /**
   * One zod schema per field, derived from the spec: declared schemas on
   * object/array fields, the record schema on list fields, and derived
   * scalar schemas (z.number(), z.string(), …) elsewhere.
   */
  public readonly schemas: SpecSchemas<S>;
  private readonly codec: Codec;
  private readonly plugins?: Record<string, ConnectorFactory>;
  private readonly entries: FieldEntry[];
  private readonly offsets = new Map<string, number>();
  private readonly versionOffset: number;
  private readonly connectors = new Map<string, Connector<any>>();
  private readonly boundListeners = new Set<() => void>();
  private isBound = false;

  constructor(spec: S, options: SharedMemoryOptions = {}) {
    this.spec = spec;
    this.codec = options.codec ?? msgpackrCodec;
    this.plugins = options.plugins;
    this.entries = flattenSpec(spec);
    this.schemas = buildSchemas(spec);
    let offset = 0;
    for (const { path, descriptor } of this.entries) {
      offset = align(offset);
      this.offsets.set(path, offset);
      offset += descriptor.byteLength;
    }
    // Version counter block: one Int32 per field, bumped via Atomics on every
    // write so the other thread can observe changes.
    this.versionOffset = align(offset);
    this.totalBytes = this.versionOffset + align(this.entries.length * 4);
    definedSharedMemories.push(this);
    memLog.info(`contract defined: ${this.entries.length} field(s), ${fmtBytes(this.totalBytes)}`, {
      fields: Object.fromEntries(this.entries.map((e) => [e.path, `${e.descriptor.kind}@${this.offsets.get(e.path)?.toLocaleString()}+${fmtBytes(e.descriptor.byteLength)}`])),
      pluginOverrides: Object.keys(this.plugins ?? {}),
    });
  }

  /** Binds this contract's connectors to the shared buffer. Called by the SDK on each thread. */
  public bind(buffer: SharedArrayBuffer): void {
    this.connectors.clear();
    const versionView = new Int32Array(buffer, this.versionOffset, this.entries.length);
    this.entries.forEach(({ path, descriptor }, index) => {
      const factory = this.plugins?.[descriptor.kind] ?? CONNECTOR_FACTORIES.get(descriptor.kind);
      if (!factory) {
        throw new Error(`Unknown shared memory field kind: ${descriptor.kind}`);
      }
      memLog.debug(`bind "${path}" (${descriptor.kind}, ${fmtBytes(descriptor.byteLength)}) via ${this.plugins?.[descriptor.kind] ? 'plugin' : 'built-in'} factory`);
      const ctx: ConnectorContext = { buffer, codec: this.codec, version: { view: versionView, index } };
      const raw = factory(descriptor, ctx, this.offsets.get(path)!);
      this.connectors.set(path, {
        ...raw,
        write: (v) => {
          raw.write(v);
          // Bump the version counter and explicitly wake waitAsync observers —
          // V8 only resolves waitAsync waiters on notify, not on value changes.
          // No count bound: every watcher on this field must wake.
          Atomics.add(versionView, index, 1);
          Atomics.notify(versionView, index);
        },
        _version: { view: versionView, index },
      });
    });
    this.isBound = true;
    for (const cb of [...this.boundListeners]) cb();
  }

  /** True once the contract has been bound to a buffer on this thread. */
  public get bound(): boolean {
    return this.isBound;
  }

  /**
   * Fires when the contract is bound on this thread — immediately if already
   * bound. Returns an unsubscribe function.
   */
  public onBound(cb: () => void): () => void {
    if (this.isBound) {
      cb();
      return () => {};
    }
    this.boundListeners.add(cb);
    return () => this.boundListeners.delete(cb);
  }

  /** Typed lookup for flat (ungrouped) field keys. */
  public connector<K extends FlatKey<S>>(key: K): SharedAccess<S>[K];
  /**
   * Looks up a bound connector by its field path — `incidents` for flat
   * fields, `lists.incidents` for grouped ones.
   */
  public connector(path: string): Connector<any>;
  public connector(path: any): any {
    const p = String(path);
    const connector = this.connectors.get(p);
    if (!connector) {
      throw new Error(`Shared memory field "${p}" was accessed before the buffer was bound on this thread.`);
    }
    return connector;
  }
}

/**
 * Defines a shared memory contract. Spec values are field descriptors or
 * intent groups (one level of nesting — the group's name is the intent):
 *
 *   defineSharedMemory({
 *     lists:   { incidents: field.list({ schema, count }) },
 *     state:   { metrics:   field.object({ maxBytes, schema }) },
 *     signals: { progress:  field.number() },
 *   });
 *
 * The returned object exposes a typed connector per field, nested the same
 * way: `memory.lists.incidents.readAt(0)`, `memory.signals.progress.write(…)`.
 * Flat members (`memory.counter`) keep working for ungrouped fields.
 */
export function defineSharedMemory<S extends SharedSpec>(
  spec: S,
  options: SharedMemoryOptions = {}
): SharedMemory<S> & Prettify<SharedAccess<S>> {
  const memory = new SharedMemory(spec, options);
  for (const [key, value] of Object.entries(spec)) {
    if (isDescriptor(value)) {
      Object.defineProperty(memory, key, {
        enumerable: true,
        get: () => memory.connector(key),
      });
    } else {
      const group: Record<string, Connector<any>> = {};
      for (const member of Object.keys(value)) {
        Object.defineProperty(group, member, {
          enumerable: true,
          get: () => memory.connector(`${key}.${member}`),
        });
      }
      Object.defineProperty(memory, key, { enumerable: true, get: () => group });
    }
  }
  return memory as SharedMemory<S> & Prettify<SharedAccess<S>>;
}

/** Binds every defined shared memory contract to the buffer. Used by the worker bootstrap. */
export function bindSharedMemories(buffer: SharedArrayBuffer): void {
  for (const memory of definedSharedMemories) {
    memory.bind(buffer);
  }
  memLog.info(`bound ${definedSharedMemories.length} contract(s) — ${fmtBytes(buffer.byteLength)} buffer`);
}

/** How many shared-memory contracts this module graph has defined. */
export function getDefinedSharedMemoryCount(): number {
  return definedSharedMemories.length;
}
