import type { Prettify, Schema } from './types';
import { msgpackrCodec } from './msgpackrCodec';
import { fmtBytes, scoped } from '../log';

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

export type SharedSpec = Record<string, FieldDescriptor>;

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

type InferField<D> = D extends FieldDescriptor<infer T> ? T : unknown;

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
/* Fixed-layout struct fields — zero serialization                     */
/* ------------------------------------------------------------------ */

export type ScalarKind = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64' | 'i64' | 'u64';

/** A struct field spec: a scalar kind, or `{ string: n }` for an inline UTF-8 field of n bytes. */
export type StructFieldSpec = ScalarKind | { string: number };
export type StructSpec = Record<string, StructFieldSpec>;

type ScalarTS<K> = K extends 'i64' | 'u64' ? bigint : number;

/** The plain-object shape of one record in a struct field. */
export type StructRecord<F extends StructSpec> = Prettify<{
  [K in keyof F]: F[K] extends { string: number } ? string : F[K] extends ScalarKind ? ScalarTS<F[K]> : unknown;
}>;

export interface StructInfo<F extends StructSpec = StructSpec> {
  fields: F;
  offsets: Record<keyof F, number>;
  recordSize: number;
  count: number;
}

export interface StructDescriptor<F extends StructSpec = StructSpec> extends FieldDescriptor<StructRecord<F>[]> {
  readonly kind: 'struct';
  readonly struct: StructInfo<F>;
}

/**
 * A connector over a fixed-layout record array. `readAt`/`writeAt` access a
 * single record directly via DataView — no encode/decode pass, ever.
 * `readAt(index, out)` reuses `out` for allocation-free scans.
 */
export interface StructConnector<R> extends Connector<R[]> {
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

export type SharedAccess<S extends SharedSpec> = {
  [K in keyof S]: S[K] extends StructDescriptor<infer F>
    ? StructConnector<StructRecord<F>>
    : Connector<InferField<S[K]>>;
};

const SCALAR_SIZES: Record<ScalarKind, number> = {
  i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8, i64: 8, u64: 8,
};

const structFieldSize = (spec: StructFieldSpec) => (typeof spec === 'string' ? SCALAR_SIZES[spec] : spec.string);
const structFieldAlign = (spec: StructFieldSpec) => (typeof spec === 'string' ? SCALAR_SIZES[spec] : 1);

/**
 * Field datatype helpers for `defineSharedMemory`.
 */
export const field = {
  number: (): FieldDescriptor<number> => ({ kind: 'number', byteLength: 8 }),
  boolean: (): FieldDescriptor<boolean> => ({ kind: 'boolean', byteLength: 8 }),
  string: ({ maxBytes }: { maxBytes: number }): FieldDescriptor<string> => ({ kind: 'string', byteLength: 4 + maxBytes }),
  object: <T = unknown>({ maxBytes, schema }: { maxBytes: number; schema?: Schema<T> }): FieldDescriptor<T> => ({ kind: 'object', byteLength: 4 + maxBytes, schema }),
  array: <T = unknown>({ maxBytes, schema }: { maxBytes: number; schema?: Schema<T[]> }): FieldDescriptor<T[]> => ({ kind: 'array', byteLength: 4 + maxBytes, schema }),
  int32Array: ({ length }: { length: number }): FieldDescriptor<Int32Array> => ({ kind: 'Int32', byteLength: length * 4 }),
  float64Array: ({ length }: { length: number }): FieldDescriptor<Float64Array> => ({ kind: 'Float64', byteLength: length * 8 }),
  bigInt64Array: ({ length }: { length: number }): FieldDescriptor<BigInt64Array> => ({ kind: 'BigInt64', byteLength: length * 8 }),
  uint8Array: ({ length }: { length: number }): FieldDescriptor<Uint8Array> => ({ kind: 'Uint8', byteLength: length }),
  /**
   * A fixed-layout array of `count` records. Every record occupies `recordSize`
   * bytes at a computable offset — reads and writes are direct memory access,
   * no serialization. `{ string: n }` fields store UTF-8 inline, zero-padded.
   */
  struct: <F extends StructSpec>({ fields, count }: { fields: F; count: number }): StructDescriptor<F> => {
    const offsets = {} as Record<keyof F, number>;
    let offset = 0;
    for (const key of Object.keys(fields) as (keyof F)[]) {
      offset = alignTo(offset, structFieldAlign(fields[key]));
      offsets[key] = offset;
      offset += structFieldSize(fields[key]);
    }
    const recordSize = align(offset);
    return {
      kind: 'struct',
      byteLength: recordSize * count,
      struct: { fields, offsets, recordSize, count },
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
  return { byteOffset, byteLength: d.byteLength, read: () => decoder.decode(readBytes()), write: (v: string) => writeBytes(encoder.encode(v)) };
});

const structuredFactory: ConnectorFactory = (d, ctx, byteOffset) => {
  const { schema, byteLength, kind } = d;
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

type ScalarIO = { get(offset: number): number | bigint; set(offset: number, value: number | bigint): void };

function structFactory(d: FieldDescriptor, ctx: ConnectorContext, byteOffset: number): StructConnector<any> {
  const { fields, offsets, recordSize, count } = (d as StructDescriptor).struct;
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

  // encodeInto can't target shared views in browsers — encode into a reused
  // non-shared scratch (sized to the largest inline string field), then copy.
  const scratchSize = Math.max(
    0,
    ...Object.values(fields).map((s) => (typeof s === 'string' ? 0 : s.string))
  );
  const scratch = new Uint8Array(scratchSize);

  const writeString = (offset: number, max: number, value: string) => {
    const { read, written } = encoder.encodeInto(value, scratch);
    if (read < value.length || written > max) {
      throw new Error(`String exceeds inline field capacity of ${max} bytes`);
    }
    byteView.set(scratch.subarray(0, written), offset);
    if (written < max) byteView.fill(0, offset + written, offset + max);
  };

  const checkIndex = (index: number) => {
    if (index < 0 || index >= count) {
      throw new RangeError(`Record index ${index} out of bounds (0..${count - 1})`);
    }
  };

  // Precompiled per-field accessors — hot loops avoid Object.keys and
  // per-record type dispatch entirely.
  const readers = new Map<string, (base: number, out: Record<string, unknown>) => void>();
  const writers = new Map<string, (base: number, record: Record<string, unknown>) => void>();
  for (const key of Object.keys(fields)) {
    const spec = fields[key];
    const rel = offsets[key];
    if (typeof spec === 'string') {
      const io = scalarIO[spec];
      readers.set(key, (base, out) => { out[key] = io.get(base + rel); });
      writers.set(key, (base, record) => io.set(base + rel, record[key] as number | bigint));
    } else {
      const max = spec.string;
      readers.set(key, (base, out) => { out[key] = readString(base + rel, max); });
      writers.set(key, (base, record) => writeString(base + rel, max, record[key] as string));
    }
  }
  const allReaders = Object.keys(fields).map((k) => readers.get(k)!);
  const allWriters = Object.keys(fields).map((k) => writers.get(k)!);

  const readAt = (index: number, out: Record<string, unknown> = {}, fieldNames?: string[]) => {
    checkIndex(index);
    const base = byteOffset + index * recordSize;
    if (fieldNames) {
      for (const key of fieldNames) readers.get(key)!(base, out);
    } else {
      for (const read of allReaders) read(base, out);
    }
    return out;
  };

  const writeAt = (index: number, record: Record<string, unknown>, fieldNames?: string[]) => {
    checkIndex(index);
    const base = byteOffset + index * recordSize;
    if (fieldNames) {
      for (const key of fieldNames) writers.get(key)!(base, record);
    } else {
      for (const write of allWriters) write(base, record);
    }
  };

  const connector: StructConnector<any> = {
    byteOffset,
    byteLength: d.byteLength,
    recordCount: count,
    recordSize,
    readAt: readAt as StructConnector<any>['readAt'],
    writeAt: writeAt as StructConnector<any>['writeAt'],
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
        throw new Error(`${records.length} records exceeds struct array capacity of ${count}`);
      }
      records.forEach((r, i) => writeAt(i, r));
    },
  };
  return connector;
}

registerConnectorFactory('struct', structFactory);

/* ------------------------------------------------------------------ */

const definedSharedMemories: SharedMemory<any>[] = [];

/**
 * A shared memory contract: a fixed, deterministic layout of typed fields over
 * a SharedArrayBuffer. Both threads import the same contract object; the pool
 * binds it on the main thread and the worker bootstrap binds it inside workers,
 * guaranteeing identical memory usage on both sides.
 */
export class SharedMemory<S extends SharedSpec = SharedSpec> {
  public readonly totalBytes: number;
  private readonly spec: S;
  private readonly codec: Codec;
  private readonly plugins?: Record<string, ConnectorFactory>;
  private readonly fieldKeys: string[];
  private readonly offsets = new Map<string, number>();
  private readonly versionOffset: number;
  private readonly connectors = new Map<string, Connector<any>>();
  private readonly boundListeners = new Set<() => void>();
  private isBound = false;

  constructor(spec: S, options: SharedMemoryOptions = {}) {
    this.spec = spec;
    this.codec = options.codec ?? msgpackrCodec;
    this.plugins = options.plugins;
    this.fieldKeys = Object.keys(spec);
    let offset = 0;
    for (const key of this.fieldKeys) {
      offset = align(offset);
      this.offsets.set(key, offset);
      offset += spec[key].byteLength;
    }
    // Version counter block: one Int32 per field, bumped via Atomics on every
    // write so the other thread can observe changes.
    this.versionOffset = align(offset);
    this.totalBytes = this.versionOffset + align(this.fieldKeys.length * 4);
    definedSharedMemories.push(this);
    memLog.info(`contract defined: ${this.fieldKeys.length} field(s), ${fmtBytes(this.totalBytes)}`, {
      fields: Object.fromEntries(this.fieldKeys.map((k) => [k, `${spec[k].kind}@${this.offsets.get(k)?.toLocaleString()}+${fmtBytes(spec[k].byteLength)}`])),
      pluginOverrides: Object.keys(this.plugins ?? {}),
    });
  }

  /** Binds this contract's connectors to the shared buffer. Called by the SDK on each thread. */
  public bind(buffer: SharedArrayBuffer): void {
    this.connectors.clear();
    const versionView = new Int32Array(buffer, this.versionOffset, this.fieldKeys.length);
    this.fieldKeys.forEach((key, index) => {
      const descriptor = this.spec[key];
      const factory = this.plugins?.[descriptor.kind] ?? CONNECTOR_FACTORIES.get(descriptor.kind);
      if (!factory) {
        throw new Error(`Unknown shared memory field kind: ${descriptor.kind}`);
      }
      memLog.debug(`bind "${key}" (${descriptor.kind}, ${fmtBytes(descriptor.byteLength)}) via ${this.plugins?.[descriptor.kind] ? 'plugin' : 'built-in'} factory`);
      const ctx: ConnectorContext = { buffer, codec: this.codec, version: { view: versionView, index } };
      const raw = factory(descriptor, ctx, this.offsets.get(key)!);
      this.connectors.set(key, {
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

  public connector<K extends keyof S>(key: K): SharedAccess<S>[K] {
    const connector = this.connectors.get(key as string);
    if (!connector) {
      throw new Error(`Shared memory field "${String(key)}" was accessed before the buffer was bound on this thread.`);
    }
    return connector as SharedAccess<S>[K];
  }
}

/**
 * Defines a shared memory contract. The returned object exposes a typed
 * connector per field: `memory.counter.read()`, `memory.values.write(...)`.
 */
export function defineSharedMemory<S extends SharedSpec>(
  spec: S,
  options: SharedMemoryOptions = {}
): SharedMemory<S> & Prettify<SharedAccess<S>> {
  const memory = new SharedMemory(spec, options);
  for (const key of Object.keys(spec)) {
    Object.defineProperty(memory, key, {
      enumerable: true,
      get: () => memory.connector(key),
    });
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
