/**
 * The SDK's vendored schema engine — the slice of zod v4 the contract layer
 * needs, implemented in-house so zod never lands in the dependency tree.
 *
 * Schemas carry zod's `_zod.def` shape (`type`, `format`, `checks`,
 * `shape`, `element`) and check defs use zod's names (`greater_than`,
 * `number_format`, `max_length`, `length_equals`, …). The layout compiler
 * reads those fields duck-typed — never `instanceof` — so consumer-supplied
 * classic zod and zod/mini schemas introspect identically: `z.uint32()`,
 * `z.object(...)`, `z.string().meta({ bytes: n })` all still work as
 * members/field schemas.
 *
 * Chain methods mini omits (`.refine()`, `.meta()`, `.max()` …) are
 * re-attached to atoll-minted schemas by `fluent()` — `reef`, `listSchema`,
 * `memory.schemas`. Refines attach via `.check()` so the schema's
 * `def.type` survives — a refined `reef.string` still lays out as a
 * fixed-width string.
 */

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

/** Check def payloads mirror zod v4's `_zod.check.def` shapes. */
export interface CheckDef {
  check: string;
  value?: number | bigint;
  inclusive?: boolean;
  format?: string;
  maximum?: number;
  minimum?: number;
  length?: number;
}

export interface Check {
  readonly _zod: { readonly def: CheckDef };
  /** Returns `true` or a failure message. */
  evaluate(value: unknown): true | string;
}

const check = (def: CheckDef, evaluate: Check['evaluate']): Check => ({
  _zod: { def }, evaluate,
});

const int32min = -2147483648, int32max = 2147483647;

const int = () => check({ check: 'number_format', format: 'safeint' }, (v) =>
  Number.isInteger(v) || 'expected an integer');
const gte = (value: number | bigint) =>
  check({ check: 'greater_than', value, inclusive: true }, (v) =>
    (v as number) >= value || `expected >= ${value}`);
const lte = (value: number | bigint) =>
  check({ check: 'less_than', value, inclusive: true }, (v) =>
    (v as number) <= value || `expected <= ${value}`);
const nonnegative = () => gte(0 as number | bigint);
const refine = (fn: (v: any) => unknown, message?: string) =>
  check({ check: 'custom' }, (v) => !!fn(v) || (message ?? 'failed custom check'));
const length = (n: number) =>
  check({ check: 'length_equals', length: n }, (v) =>
    (v as { length: number }).length === n || `expected exactly ${n} items`);
const maxLength = (n: number) =>
  check({ check: 'max_length', maximum: n }, (v) =>
    (v as { length: number }).length <= n || `expected <=${n} items`);
const minLength = (n: number) =>
  check({ check: 'min_length', minimum: n }, (v) =>
    (v as { length: number }).length >= n || `expected >=${n} items`);
const intRange = (format: string, min: number, max: number) =>
  check({ check: 'number_format', format }, (v) =>
    (Number.isInteger(v) && (v as number) >= min && (v as number) <= max) ||
    `expected a ${format}`);
const int64Range = (format: string, min: bigint, max: bigint) =>
  check({ check: 'bigint_format', format }, (v) =>
    ((v as bigint) >= min && (v as bigint) <= max) || `expected a ${format}`);

/* ------------------------------------------------------------------ */
/* Registry — `.meta()` storage, mirrors zod's globalRegistry           */
/* ------------------------------------------------------------------ */

const registryStore = new WeakMap<object, Record<string, unknown>>();

export const globalRegistry = {
  add(schema: object, meta: Record<string, unknown>) {
    registryStore.set(schema, meta);
  },
  get(schema: object): Record<string, unknown> | undefined {
    return registryStore.get(schema);
  },
};
export type Registry = typeof globalRegistry;

/* ------------------------------------------------------------------ */
/* Schema base + concrete kinds                                        */
/* ------------------------------------------------------------------ */

export interface SchemaDef {
  type: string;
  checks?: Check[];
  format?: string;
  shape?: Record<string, ZodLike>;
  element?: ZodLike;
  cls?: abstract new (...args: any[]) => unknown;
}

export class SchemaError extends Error {
  override readonly name = 'SchemaError';
}

/** The minimal schema shape — satisfied by ours and by real zod schemas. */
export interface ZodLike<Output = unknown, Input = Output> {
  readonly _zod: {
    readonly output: Output;
    readonly input: Input;
    readonly def: { readonly type?: string; readonly checks?: readonly unknown[] };
  };
  parse(value: unknown): Output;
  safeParse(value: unknown):
    | { success: true; data: Output }
    | { success: false; error: unknown };
}

export abstract class ZodType<Output = unknown, Input = Output>
  implements ZodLike<Output, Input> {
  readonly _zod: { output: Output; input: Input; def: SchemaDef };

  constructor(def: SchemaDef) {
    this._zod = { def } as { output: Output; input: Input; def: SchemaDef };
  }

  /** Base-kind check — subclasses enforce the primitive before checks run. */
  abstract inner(value: unknown): Output;

  parse(value: unknown): Output {
    const parsed = this.inner(value);
    for (const c of this._zod.def.checks ?? []) {
      const r = c.evaluate(parsed);
      if (r !== true) throw new SchemaError(r);
    }
    return parsed;
  }

  safeParse(value: unknown):
    | { success: true; data: Output }
    | { success: false; error: unknown } {
    try {
      return { success: true, data: this.parse(value) };
    } catch (error) {
      return { success: false, error };
    }
  }

  /** Returns a new schema with the checks appended (def.type unchanged). */
  check(...checks: Check[]): this {
    const clone = Object.create(Object.getPrototypeOf(this)) as this;
    const def = { ...this._zod.def, checks: [...(this._zod.def.checks ?? []), ...checks] };
    (clone as { _zod: unknown })._zod = { def };
    // Meta is per-instance but shouldn't die across a check-chain clone.
    const meta = globalRegistry.get(this);
    if (meta) globalRegistry.add(clone, meta);
    return clone;
  }

  register(registry: Registry, meta: Record<string, unknown>): this {
    registry.add(this, meta);
    return this;
  }
}

const fail = (expected: string): never => {
  throw new SchemaError(`expected ${expected}`);
};

class ZodNumber extends ZodType<number> {
  declare readonly _zod: { output: number; input: number; def: SchemaDef & { type: 'number' } };
  inner(v: unknown): number {
    return typeof v === 'number' && !Number.isNaN(v) ? v : fail('number');
  }
}
class ZodString extends ZodType<string> {
  declare readonly _zod: { output: string; input: string; def: SchemaDef & { type: 'string' } };
  inner(v: unknown): string {
    return typeof v === 'string' ? v : fail('string');
  }
}
class ZodBoolean extends ZodType<boolean> {
  declare readonly _zod: { output: boolean; input: boolean; def: SchemaDef & { type: 'boolean' } };
  inner(v: unknown): boolean {
    return typeof v === 'boolean' ? v : fail('boolean');
  }
}
class ZodBigint extends ZodType<bigint> {
  declare readonly _zod: { output: bigint; input: bigint; def: SchemaDef & { type: 'bigint' } };
  inner(v: unknown): bigint {
    return typeof v === 'bigint' ? v : fail('bigint');
  }
}
class ZodUnknown extends ZodType<unknown> {
  inner(v: unknown): unknown {
    return v;
  }
}
class ZodInstanceof<T> extends ZodType<T> {
  inner(v: unknown): T {
    const cls = this._zod.def.cls!;
    return v instanceof cls ? (v as T) : fail(cls.name ?? 'instance');
  }
}

type ShapeOutput<S extends Record<string, ZodLike>> = {
  [K in keyof S]: S[K] extends { _zod: { output: infer O } } ? O : never;
};

/** Strips unknown keys like zod's object parse — output is the shape only. */
class ZodObjectSchema<S extends Record<string, ZodLike>> extends ZodType<ShapeOutput<S>> {
  declare readonly _zod: {
    output: ShapeOutput<S>; input: ShapeOutput<S>;
    def: SchemaDef & { type: 'object'; shape: S };
  };
  get shape(): S {
    return this._zod.def.shape;
  }
  inner(v: unknown): ShapeOutput<S> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('object');
    const out: Record<string, unknown> = {};
    for (const [k, member] of Object.entries(this.shape)) {
      out[k] = member.parse((v as Record<string, unknown>)[k]);
    }
    return out as ShapeOutput<S>;
  }
}

class ZodArraySchema<E extends ZodLike> extends ZodType<OutputOf<E>[]> {
  declare readonly _zod: {
    output: OutputOf<E>[]; input: OutputOf<E>[];
    def: SchemaDef & { type: 'array'; element: E };
  };
  inner(v: unknown): OutputOf<E>[] {
    if (!Array.isArray(v)) return fail('array');
    const el = this._zod.def.element;
    return (v as unknown[]).map((item) => el.parse(item)) as OutputOf<E>[];
  }
}

type OutputOf<S> = S extends { _zod: { output: infer O } } ? O : never;

/* ------------------------------------------------------------------ */
/* Factories — the vendored `zod/mini` spelling                         */
/* ------------------------------------------------------------------ */

const number = () => new ZodNumber({ type: 'number' });
const string = () => new ZodString({ type: 'string' });
const boolean_ = () => new ZodBoolean({ type: 'boolean' });
const bigint_ = () => new ZodBigint({ type: 'bigint' });
const unknown_ = () => new ZodUnknown({ type: 'unknown' });
const instanceof_ = <T extends abstract new (...args: any[]) => any>(cls: T) =>
  new ZodInstanceof<InstanceType<T>>({ type: 'instanceof', cls });
const object_ = <S extends Record<string, ZodLike>>(shape: S) =>
  new ZodObjectSchema<S>({ type: 'object', shape });
const array = <E extends ZodLike>(element: E) =>
  new ZodArraySchema<E>({ type: 'array', element });

const int32 = () => new ZodNumber({ type: 'number', format: 'int32' }).check(intRange('int32', int32min, int32max));
const uint32 = () => new ZodNumber({ type: 'number', format: 'uint32' }).check(intRange('uint32', 0, 4294967295));
const float32 = () => new ZodNumber({ type: 'number', format: 'float32' });
const float64 = () => new ZodNumber({ type: 'number', format: 'float64' });
const int64 = () => new ZodBigint({ type: 'bigint', format: 'int64' }).check(int64Range('int64', -(2n ** 63n), 2n ** 63n - 1n));
const uint64 = () => new ZodBigint({ type: 'bigint', format: 'uint64' }).check(int64Range('uint64', 0n, 2n ** 64n - 1n));

/* ------------------------------------------------------------------ */
/* Fluent — the classic chain spellings, re-attached                    */
/* ------------------------------------------------------------------ */

/** Sized kinds take length checks; numerics take value bounds. */
const SIZED = new Set(['string', 'array', 'set']);
const boundCheck = (schema: ZodType, side: 'min' | 'max', v: number | bigint) => {
  const sized = SIZED.has(schema._zod.def.type);
  if (side === 'min') return sized ? minLength(v as number) : gte(v);
  return sized ? maxLength(v as number) : lte(v);
};

/** The chainable spellings re-added to atoll-minted schemas. */
export type Fluent<S extends ZodLike> = S & {
  /** Custom check via `.check()` — keeps `def.type`, unlike a wrapping refine. */
  refine(fn: (value: S['_zod']['output']) => unknown, params?: string): Fluent<S>;
  /** `meta()` reads, `meta(m)` writes — backed by the module registry. */
  meta(): Record<string, unknown> | undefined;
  meta(m: Record<string, unknown>): Fluent<S>;
  min(value: number | bigint): Fluent<S>;
  max(value: number | bigint): Fluent<S>;
  length(n: number): Fluent<S>;
  int(): Fluent<S>;
};

/** Attaches the `Fluent` methods as non-enumerable own properties. */
export function fluent<S extends ZodType>(schema: S): Fluent<S> {
  const boundCheck_ = schema.check.bind(schema) as (...c: Check[]) => S;
  const register = schema.register.bind(schema) as (r: Registry, m: Record<string, unknown>) => S;
  const own: Record<string, unknown> = {
    refine: (fn: (v: unknown) => unknown, params?: string) => fluent(boundCheck_(refine(fn, params))),
    meta: (m?: Record<string, unknown>) =>
      m === undefined ? globalRegistry.get(schema) : fluent(register(globalRegistry, m)),
    min: (v: number | bigint) => fluent(boundCheck_(boundCheck(schema, 'min', v))),
    max: (v: number | bigint) => fluent(boundCheck_(boundCheck(schema, 'max', v))),
    length: (n: number) => fluent(boundCheck_(length(n))),
    int: () => fluent(boundCheck_(int())),
  };
  for (const [key, fn] of Object.entries(own)) {
    Object.defineProperty(schema, key, { value: fn, enumerable: false, configurable: true });
  }
  return schema as Fluent<S>;
}

/* ------------------------------------------------------------------ */
/* Facade                                                              */
/* ------------------------------------------------------------------ */

export const z = {
  number, string, boolean: boolean_, bigint: bigint_, object: object_, array,
  instanceof: instanceof_, unknown: unknown_,
  int32, uint32, float32, float64, int64, uint64,
  int, gte, lte, nonnegative, refine, length, maxLength, minLength,
  globalRegistry,
  /** Base classes — `instanceof` covers atoll-minted schemas. */
  ZodType, ZodObject: ZodObjectSchema, ZodArray: ZodArraySchema, ZodString,
};

export namespace z {
  /* Structural aliases — public signatures speak in these so classic zod,
   * zod/mini, and atoll-minted schemas are all assignable. */
  export type ZodTypeAny = ZodLike;
  export type ZodType<Output = unknown, Input = unknown> = ZodLike<Output, Input>;
  export type ZodRawShape = Record<string, ZodLike>;
  export interface ZodObject<S extends ZodRawShape = ZodRawShape>
    extends ZodLike<ShapeOutput<S>, ShapeOutput<S>> {
    readonly _zod: {
      output: ShapeOutput<S>;
      input: ShapeOutput<S>;
      def: { type: 'object'; shape: S; checks?: readonly unknown[] };
    };
  }
  export interface ZodArray<E extends ZodTypeAny = ZodTypeAny>
    extends ZodLike<OutputOf<E>[]> {
    readonly _zod: {
      output: OutputOf<E>[];
      input: OutputOf<E>[];
      def: { type: 'array'; element: E; checks?: readonly unknown[] };
    };
  }
  export interface ZodString extends ZodLike<string> {
    readonly _zod: {
      output: string; input: string;
      def: { type: 'string'; checks?: readonly unknown[] };
    };
  }
  export type ZodMiniObject<S extends ZodRawShape = ZodRawShape> = ZodObject<S>;
  export type output<T extends ZodTypeAny> = OutputOf<T>;
}
