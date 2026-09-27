import { z } from 'zod';
import { msgpackrCodec } from '../../sdk/contract/msgpackrCodec';
import { defineSharedMemory, field } from '../../sdk/contract/sharedMemory';
import { structSchema } from '../../sdk/contract/structSchema';

export const CATEGORIES = ['electronics', 'grocery', 'apparel', 'tools', 'home'];

/* ── Flat record spec (fixed-layout path) ─────────────────────────────────
   The same order data as 32-byte records — direct DataView access, no
   serialize/validate pass. category/active are u8 codes, sku is inline.
   The spec produces the layout, record type, and zod schema in one place.  */

export const flatRecordSpec = {
  id: 'u32',
  price: 'f64',
  quantity: 'u16',
  active: 'u8',   // 0/1
  category: 'u8', // index into CATEGORIES
  sku: { string: 12 },
} as const;

/* ── Schemas ──────────────────────────────────────────────────────────────
   flatRecordSchema is generated from the spec with storage bounds; the
   structured schemas describe the serialized path and result shapes.       */

export const flatRecordSchema = structSchema(flatRecordSpec);

/** Fake order records for the serialized path — codec+validate pipeline. */
export const orderSchema = z.object({
  id: z.number(),
  sku: z.string(),
  category: z.string(),
  price: z.number(),
  quantity: z.number(),
  active: z.boolean(),
});

export const orderArraySchema = z.array(orderSchema);

/** What the worker computes over the dataset and publishes back. */
export const analysisSchema = z.object({
  count: z.number(),
  activeCount: z.number(),
  revenue: z.number(),
  byCategory: z.record(z.string(), z.number()),
  decodeMs: z.number(),
  validateMs: z.number(),
  scanMs: z.number(),
  computedBy: z.string(),
});

/* ── Inferred types ───────────────────────────────────────────────────────
   FlatRecord ≡ StructRecord<typeof flatRecordSpec> — the connector's
   record type — so parsed rows flow straight into readAt/writeAt.          */

export type FlatRecord = z.infer<typeof flatRecordSchema>;
export type OrderRecord = z.infer<typeof orderSchema>;
export type Analysis = z.infer<typeof analysisSchema>;

/* ── Shared memory contract ───────────────────────────────────────────────
   Zero-copy counter array, a structured payload field for connector-write
   measurement, a scalar for notify overhead, then the two dataset regions:
   serialized (msgpackr + zod) vs fixed-layout records.                     */

export const benchMemory = defineSharedMemory({
  counters: field.int32Array({ length: 64 }),
  payload: field.object({ maxBytes: 2048, schema: z.object({
    seq: z.number(),
    values: z.array(z.number()),
    label: z.string(),
  }) }),
  checksum: field.number(),
  records: field.array({ maxBytes: 200_000_000, schema: orderArraySchema }), // ~200MB of structured records
  recordsFlat: field.struct({ fields: flatRecordSpec, count: 2_000_000 }), // 2M × 32B = 64MB, zero-serialization layout
  analysis: field.object({ maxBytes: 512, schema: analysisSchema }),
}, { codec: msgpackrCodec });
