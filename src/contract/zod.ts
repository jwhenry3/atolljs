/**
 * The SDK's vendored zod surface — everything the contract layer needs,
 * narrowed.
 *
 * `import { z } from 'zod'` bundles the ENTIRE classic namespace in consumer
 * builds (~440KB minified): the `z` object can't be property-shaken, so it
 * drags in every locale, the JSON-schema processors, and the compile
 * pipeline. Named imports tree-shake (~93KB for the full set below).
 *
 * `instanceof` guards use the `$Zod*` base classes from `zod/v4/core` —
 * classic AND mini schemas both extend them, so user-supplied schemas match
 * either way. Constructors stay classic (`zod` named imports) because `mz`
 * output and `memory.schemas` are documented as ordinary zod — `.meta()`,
 * `.refine()`, `.parse()` must all work and compose with the consumer's own
 * `z.object(...)`.
 */
import {
  array, bigint, boolean, instanceof as instanceof_,
  int32, int64, float32, float64, number, object, string, uint32, uint64,
  unknown as unknown_,
} from 'zod';
import { $ZodArray, $ZodObject, $ZodString, $ZodType } from 'zod/v4/core';
import type * as zod from 'zod';

export const z = {
  number, string, boolean, bigint, object, array,
  instanceof: instanceof_, unknown: unknown_,
  int32, uint32, float32, float64, int64, uint64,
  /** Core classes — instanceof-matching for user schemas (classic or mini). */
  ZodType: $ZodType, ZodObject: $ZodObject, ZodArray: $ZodArray, ZodString: $ZodString,
};

export namespace z {
  /* Type surface — the classic zod types the contract layer annotates with.
   * Value positions above are the runtime; these are the types the public
   * signatures speak in (users pass real classic schemas). */
  export type ZodTypeAny = zod.ZodTypeAny;
  export type ZodType<Output = unknown, Input = unknown> = zod.ZodType<Output, Input>;
  export type ZodString = zod.ZodString;
  export type ZodArray<T extends zod.ZodTypeAny = zod.ZodTypeAny> = zod.ZodArray<T>;
  export type ZodObject<S extends zod.ZodRawShape = zod.ZodRawShape> = zod.ZodObject<S>;
  export type ZodRawShape = zod.ZodRawShape;
  export type output<T extends zod.ZodTypeAny> = zod.output<T>;
}
