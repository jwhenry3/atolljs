import { z } from 'zod';
import type { ScalarKind, StructRecord, StructSpec } from './sharedMemory';

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

/** Maps a struct field spec to the zod shape whose inferred output type is
 *  identical to `StructRecord<F>`. */
export type StructZodShape<F extends StructSpec> = {
  [K in keyof F]: F[K] extends { string: number }
    ? z.ZodType<string>
    : F[K] extends 'i64' | 'u64'
      ? z.ZodType<bigint>
      : z.ZodType<number>;
};

/**
 * Builds a zod object schema from a struct field spec — the same spec object
 * passed to `field.struct(...)`. `z.infer` of the result is the record type,
 * so a single spec declaration produces the layout, the connector type, AND
 * the validation schema:
 *
 * ```ts
 * const spec = { id: 'u32', site: { string: 10 } } as const;
 * const schema = structSchema(spec);         // zod object with storage bounds
 * type Row = z.infer<typeof schema>;         // = StructRecord<typeof spec>
 * ```
 *
 * `{ string: n }` fields validate UTF-8 byte length, matching the inline
 * capacity the connector enforces.
 */
export function structSchema<F extends StructSpec>(fields: F): z.ZodObject<StructZodShape<F>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(fields)) {
    const spec = fields[key];
    shape[key] =
      typeof spec === 'string'
        ? SCALAR_SCHEMAS[spec]
        : z.string().refine(
            (s) => utf8.encode(s).byteLength <= spec.string,
            `exceeds ${spec.string} UTF-8 bytes`
          );
  }
  return z.object(shape) as unknown as z.ZodObject<StructZodShape<F>>;
}
