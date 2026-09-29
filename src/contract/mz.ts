import { z } from 'zod';

/**
 * Atoll zod — the fixed-width schema vocabulary. Every helper produces a
 * plain zod schema the layout compiler can read a byte width from: number
 * formats (`mz.u32()`), int bounds (`mz.int(0, 3)` → u8), byte budgets
 * (`mz.string(10)`), or flags (`mz.boolean()` → u8). There are no unfixed
 * members — `mz.number()`/`z.date()`/`z.enum()` aren't exposed because they
 * can't promise a width.
 *
 * Width coverage: zod 4 provides int32/uint32/float32/float64/int64/uint64
 * formats; mz fills the gaps (i8/u8/i16/u16 via bounded ints, which the
 * compiler narrows identically) so all ten scalar kinds have one spelling.
 *
 * Composition derives byte width upward — `mz.object({...})` members lay out
 * as a fixed record (field.object derives byteLength from it, no maxBytes),
 * `mz.array(el).max(n)` bounds element capacity for field.array, and
 * `mz.string(n)` carries the budget for field.string. The returned values are
 * ordinary zod schemas — `.meta()`, `.refine()`, `.max()` all still work.
 */
export const mz = {
  i8: () => z.number().int().min(-128).max(127),
  u8: () => z.number().int().min(0).max(255),
  i16: () => z.number().int().min(-32768).max(32767),
  u16: () => z.number().int().min(0).max(65535),
  i32: () => z.int32(),
  u32: () => z.uint32(),
  f32: () => z.float32(),
  f64: () => z.float64(),
  i64: () => z.int64(),
  u64: () => z.uint64(),
  /** Bounded int — compiles to the narrowest covering kind (0..3 → u8). */
  int: (min: number, max: number) => z.number().int().min(min).max(max),
  /** A flag byte — reads and writes as boolean. */
  boolean: () => z.boolean(),
  /** Fixed-capacity inline UTF-8 string — `bytes` is the byte budget. The
   *  schema itself refuses over-budget values, so `.parse` and connector
   *  writes enforce the same limit. */
  string: (bytes: number) =>
    z.string().refine(
      (s) => new TextEncoder().encode(s).byteLength <= bytes,
      `exceeds ${bytes} UTF-8 bytes`
    ).meta({ bytes }),
  /** A fixed-layout record shape — every member must be a fixed-width schema. */
  object: <S extends z.ZodRawShape>(shape: S) => z.object(shape),
  /** A fixed-stride element — bound it with `.max(n)` or `.length(n)` before field.array. */
  array: <E extends z.ZodTypeAny>(element: E) => z.array(element),
};
