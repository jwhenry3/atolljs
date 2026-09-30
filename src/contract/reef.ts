import { z, fluent } from './zod';

const utf8 = new TextEncoder();

/**
 * Reef — the atoll's structural barrier: the fixed-width schema
 * vocabulary standing between your data and the raw buffer. Every helper
 * mints a schema the layout compiler can read a byte width from: number
 * formats (`reef.u32()`), int bounds (`reef.int(0, 3)` → u8), byte budgets
 * (`reef.string(10)`), or flags (`reef.boolean()` → u8). There are no unfixed
 * members — `reef.number()`/`z.date()`/`z.enum()` aren't exposed because they
 * can't promise a width.
 *
 * Schemas are minted by the vendored engine in `./zod.ts` — a zod-shaped
 * `_zod.def` surface (`type`/`format`/`checks`/`shape`/`element`), so no
 * zod dependency ships. Width coverage: int32/uint32/float32/float64/
 * int64/uint64 are format-tagged; reef fills the gaps (i8/u8/i16/u16 via
 * bounded ints, which the compiler narrows identically) so all ten scalar
 * kinds have one spelling.
 *
 * Composition derives byte width upward — `reef.object({...})` members lay out
 * as a fixed record (field.object derives byteLength from it, no maxBytes),
 * `reef.array(el).max(n)` bounds element capacity for field.array, and
 * `reef.string(n)` carries the budget for field.string. Schemas keep the
 * classic chain spellings — `.meta()`, `.refine()`, `.max()`/`.length()` —
 * and consumer-supplied zod schemas introspect identically through their
 * `_zod.def`, so `reef.object({ id: z.uint32() })` mixes freely.
 */
export const reef = {
  i8: () => fluent(z.number().check(z.int(), z.gte(-128), z.lte(127))),
  u8: () => fluent(z.number().check(z.int(), z.gte(0), z.lte(255))),
  i16: () => fluent(z.number().check(z.int(), z.gte(-32768), z.lte(32767))),
  u16: () => fluent(z.number().check(z.int(), z.gte(0), z.lte(65535))),
  i32: () => fluent(z.int32()),
  u32: () => fluent(z.uint32()),
  f32: () => fluent(z.float32()),
  f64: () => fluent(z.float64()),
  i64: () => fluent(z.int64()),
  u64: () => fluent(z.uint64()),
  /** Bounded int — compiles to the narrowest covering kind (0..3 → u8). */
  int: (min: number, max: number) => fluent(z.number().check(z.int(), z.gte(min), z.lte(max))),
  /** A flag byte — reads and writes as boolean. */
  boolean: () => fluent(z.boolean()),
  /** Fixed-capacity inline UTF-8 string — `bytes` is the byte budget. The
   *  schema itself refuses over-budget values, so `.parse` and connector
   *  writes enforce the same limit. */
  string: (bytes: number) =>
    fluent(
      z.string()
        .check(
          z.refine(
            (s: string) => utf8.encode(s).byteLength <= bytes,
            `exceeds ${bytes} UTF-8 bytes`
          )
        )
        .register(z.globalRegistry, { bytes })
    ),
  /** A fixed-layout record shape — every member must be a fixed-width schema. */
  object: <S extends z.ZodRawShape>(shape: S) => fluent(z.object(shape)),
  /** A fixed-stride element — bound it with `.max(n)` or `.length(n)` before field.array. */
  array: <E extends z.ZodTypeAny>(element: E) => fluent(z.array(element)),
};
