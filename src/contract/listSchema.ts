import { z } from './zod';
import type {
  ScalarKind,
  ListFieldSpec,
  ListFields,
  ListMember,
} from './sharedMemory';

const utf8 = new TextEncoder();

/** Storage-bounded zod schemas per scalar kind — validation catches
 *  out-of-range values at the contract boundary instead of silently
 *  truncating at write time. */
const SCALAR_SCHEMAS: Record<ScalarKind, z.ZodTypeAny> = {
  i8: z.number().int().min(-128).max(127),
  u8: z.number().int().min(0).max(255),
  i16: z.number().int().min(-32768).max(32767),
  u16: z.number().int().min(0).max(65535),
  i32: z.number().int().min(-2147483648).max(2147483647),
  u32: z.number().int().min(0).max(4294967295),
  f32: z.number(),
  f64: z.number(),
  i64: z.bigint(),
  u64: z.bigint().nonnegative(),
};

const byteBounded = (bytes: number) =>
  z.string().refine(
    (s) => utf8.encode(s).byteLength <= bytes,
    `exceeds ${bytes} UTF-8 bytes`
  );

/** Maps a list member to the zod shape whose inferred output type is
 *  identical to `ListRecord<F>[K]` — zod members pass through as
 *  themselves so declared bounds (e.g. `.max(3)`) stay in effect. */
export type ListZodShape<F extends ListFields> = {
  [K in keyof F]: F[K] extends z.ZodTypeAny
    ? F[K]
    : F[K] extends { string: number }
      ? z.ZodType<string>
      : F[K] extends { bool: boolean }
        ? z.ZodType<boolean>
        : F[K] extends 'i64' | 'u64'
          ? z.ZodType<bigint>
          : z.ZodType<number>;
};

/**
 * Builds a zod object schema from a member map — the shape you would pass
 * to `mz.object(...)` for `field.list({ schema, count })`. Members may be
 * spec tokens or zod schemas; the result's `z.infer` is the record type:
 *
 * ```ts
 * const shape = { id: 'u32', site: { string: 10 } } as const;
 * const schema = listSchema(shape);            // zod object with storage bounds
 * type Row = z.infer<typeof schema>;
 * ```
 *
 * `{ string: n }` fields validate UTF-8 byte length, matching the inline
 * capacity the connector enforces; zod `z.string().meta({ bytes: n })`
 * members get the same bound attached to the declared schema.
 */
export function listSchema<F extends ListFields>(fields: F): z.ZodObject<ListZodShape<F>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(fields)) {
    shape[key] = memberToSchema(fields[key]);
  }
  return z.object(shape) as unknown as z.ZodObject<ListZodShape<F>>;
}

function memberToSchema(member: ListMember): z.ZodTypeAny {
  if (member instanceof z.ZodType) {
    const bytes =
      member._zod.def?.type === 'string' ? zodMetaBytes(member) : undefined;
    return typeof bytes === 'number'
      ? member.refine((s) => utf8.encode(s as string).byteLength <= bytes, `exceeds ${bytes} UTF-8 bytes`)
      : member;
  }
  return typeof member === 'string'
    ? SCALAR_SCHEMAS[member]
    : 'string' in member ? byteBounded(member.string) : z.boolean();
}

/* ------------------------------------------------------------------ */
/* zod members → binary layout                                         */
/* ------------------------------------------------------------------ */

const NUMBER_FORMATS: Record<string, ScalarKind> = {
  int32: 'i32',
  uint32: 'u32',
  float32: 'f32',
  float64: 'f64',
};

const BIGINT_FORMATS: Record<string, ScalarKind> = {
  int64: 'i64',
  uint64: 'u64',
};

/** Narrowest-first, unsigned-preferred — `min(0).max(3)` → 'u8'. */
const INT_BOUNDS: { kind: ScalarKind; min: number; max: number }[] = [
  { kind: 'u8', min: 0, max: 255 },
  { kind: 'i8', min: -128, max: 127 },
  { kind: 'u16', min: 0, max: 65535 },
  { kind: 'i16', min: -32768, max: 32767 },
  { kind: 'u32', min: 0, max: 4294967295 },
  { kind: 'i32', min: -2147483648, max: 2147483647 },
];

interface ZodCheckDef {
  check?: string;
  value?: number;
  inclusive?: boolean;
  format?: string;
  /** `max_length` check payload. */
  maximum?: number;
  /** `length_equals` check payload. */
  length?: number;
}

interface ZodMemberDef {
  type?: string;
  format?: string;
  // check defs sit on `c.def` (ZodNumberFormat) or `c._zod.def` ($ZodCheck*)
  checks?: { def?: ZodCheckDef; _zod?: { def?: ZodCheckDef } }[];
}

const checkDef = (c: { def?: ZodCheckDef; _zod?: { def?: ZodCheckDef } }) => c.def ?? c._zod?.def;

function numberMemberToSpec(def: ZodMemberDef): ListFieldSpec {
  const formats = [def.format, ...(def.checks ?? []).map((c) => checkDef(c)?.format)];
  const direct = formats.find((f): f is string => !!f && f in NUMBER_FORMATS);
  if (direct) return NUMBER_FORMATS[direct];
  // Bounded integers narrow to the smallest covering kind — `z.int().min(0).max(3)`
  // declares a domain (0..3) AND a storage width (u8) in one expression.
  if (formats.includes('safeint')) {
    let min = -Infinity;
    let max = Infinity;
    for (const c of def.checks ?? []) {
      const cd = checkDef(c);
      if (cd?.check === 'greater_than' && cd.inclusive) min = cd.value ?? min;
      if (cd?.check === 'less_than' && cd.inclusive) max = cd.value ?? max;
    }
    for (const b of INT_BOUNDS) {
      if (min >= b.min && max <= b.max) return b.kind;
    }
  }
  return 'f64';
}

/**
 * Compiles one fixed-layout member — a spec token or a zod schema — to its
 * binary layout form. Throws for members that can't express a fixed-width
 * layout.
 */
export function memberToSpec(member: ListMember, name: string): ListFieldSpec {
  if (typeof member === 'string') return member;
  if (!(member instanceof z.ZodType)) {
    if (typeof (member as { string?: unknown }).string === 'number') return member as { string: number };
    if ((member as { bool?: unknown }).bool === true) return member as { bool: true };
    throw new TypeError(`member "${name}": expected a scalar token, { string: n }, { bool: true }, or a zod schema`);
  }
  const def = member._zod.def as unknown as ZodMemberDef;
  if (def.type === 'number') return numberMemberToSpec(def);
  if (def.type === 'bigint') return BIGINT_FORMATS[def.format ?? ''] ?? 'i64';
  if (def.type === 'boolean') return { bool: true };
  if (def.type === 'string') {
    const bytes = zodMetaBytes(member);
    if (typeof bytes === 'number') return { string: bytes };
    throw new TypeError(
      `member "${name}": z.string() needs .meta({ bytes: n }) — inline strings are fixed-width`
    );
  }
  throw new TypeError(
    `member "${name}": zod "${def.type}" can't lay out as a fixed-width scalar — use number, bigint, boolean, or a bounded string`
  );
}

/* ------------------------------------------------------------------ */
/* zod schema → fixed layout (introspection for field factories)       */
/* ------------------------------------------------------------------ */

/** The declared member map of a zod object, or null when `schema` isn't one. */
export function zodObjectShape(schema: unknown): ListFields | null {
  if (!(schema instanceof z.ZodObject)) return null;
  return (schema._zod.def as unknown as { shape: ListFields }).shape;
}

/**
 * Element schema + capacity of a bounded zod array — `.max(n)` /
 * `.length(n)` carry the bound in their checks. Returns null for non-array
 * schemas; `capacity` is null for unbounded arrays.
 */
export function zodArrayInfo(schema: unknown): { element: z.ZodTypeAny; capacity: number | null } | null {
  if (!(schema instanceof z.ZodArray)) return null;
  const def = schema._zod.def as unknown as ZodMemberDef & { element: z.ZodTypeAny };
  let capacity: number | null = null;
  for (const c of def.checks ?? []) {
    const cd = checkDef(c);
    if (cd?.check === 'max_length' && typeof cd.maximum === 'number') capacity = cd.maximum;
    if (cd?.check === 'length_equals' && typeof cd.length === 'number') capacity = cd.length;
  }
  return { element: def.element, capacity };
}

/** `.meta()?.bytes` — optional-call: mini schemas ($ZodString too) have no `.meta` method. */
function zodMetaBytes(schema: unknown): number | null {
  const meta = (schema as { meta?: () => { bytes?: unknown } }).meta?.();
  return typeof meta?.bytes === 'number' ? meta.bytes : null;
}

/** The byte budget carried by `mz.string(n)` / `z.string().meta({ bytes: n })` — null otherwise. */
export function zodStringBytes(schema: unknown): number | null {
  if (!(schema instanceof z.ZodString)) return null;
  return zodMetaBytes(schema);
}
