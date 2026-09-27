import { z } from 'zod';
import { msgpackrCodec } from '../../sdk/contract/msgpackrCodec';
import { defineSharedMemory, field } from '../../sdk/contract/sharedMemory';
import { structSchema } from '../../sdk/contract/structSchema';

/* ── Record spec — single source of truth ─────────────────────────────────
   One instrument quote, 48 bytes, updated in place by the feed. Produces
   the memory layout, the connector's record type, and the zod schema.
   The hot tick path touches only the QUOTE_HOT_FIELDS subset — symbol and
   open are written once at seed via field-projection writes.               */

export const quoteSpec = {
  symbol: { string: 8 },
  bid: 'f64',
  ask: 'f64',
  last: 'f64',
  open: 'f64',   // session open — reference for change%
  volume: 'u32', // cumulative shares
  ticks: 'u32',  // updates this session
} as const;

/** Feed-hot fields — tick updates never touch symbol/open. */
export const QUOTE_HOT_FIELDS: (keyof Quote)[] = ['bid', 'ask', 'last', 'volume', 'ticks'];

/* ── Schemas ──────────────────────────────────────────────────────────────
   quoteSchema is generated from the spec with storage bounds; the rest are
   aggregates and screener results the worker hands back.                   */

export const quoteSchema = structSchema(quoteSpec);

export const marketStatsSchema = z.object({
  ticks: z.number(),
  instruments: z.number(),
  totalVolume: z.number(),
  advancers: z.number(),
  decliners: z.number(),
  unchanged: z.number(),
  topMover: z.object({ symbol: z.string(), changePct: z.number() }),
  computedBy: z.string(),
});

export const screenHitSchema = z.object({
  symbol: z.string(),
  last: z.number(),
  changePct: z.number(),
  volume: z.number(),
});

/* ── Inferred types ───────────────────────────────────────────────────────
   Quote ≡ StructRecord<typeof quoteSpec> — the connector's record type.    */

export type Quote = z.infer<typeof quoteSchema>;
export type MarketStats = z.infer<typeof marketStatsSchema>;
export type ScreenHit = z.infer<typeof screenHitSchema>;

/* ── Shared memory contract ───────────────────────────────────────────────
   10k × 48B quote records + a structured stats object the worker publishes
   for the main thread to observe reactively.                               */

export const marketMemory = defineSharedMemory({
  quotes: field.struct({ fields: quoteSpec, count: 10_000 }),
  stats: field.object({ maxBytes: 2048, schema: marketStatsSchema }),
}, { codec: msgpackrCodec });
