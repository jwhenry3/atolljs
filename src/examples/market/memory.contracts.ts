import { z } from 'zod';
import { msgpackrCodec } from '../../sdk/contract/msgpackrCodec';
import { defineSharedMemory, field } from '../../sdk/contract/sharedMemory';
import { mz } from '../../sdk/contract/mz';

/* ── Record schema — single source of truth ───────────────────────────────
   One instrument quote, 48 bytes, updated in place by the feed. The schema
   produces the memory layout, the connector's record type, and validation.
   The hot tick path touches only the QUOTE_HOT_FIELDS subset — symbol and
   open are written once at seed via field-projection writes.               */

export const quoteSchema = mz.object({
  symbol: mz.string(8),
  bid: mz.f64(),
  ask: mz.f64(),
  last: mz.f64(),
  open: mz.f64(),   // session open — reference for change%
  volume: mz.u32(), // cumulative shares
  ticks: mz.u32(),  // updates this session
});

/** Feed-hot fields — tick updates never touch symbol/open. */
export const QUOTE_HOT_FIELDS: (keyof Quote)[] = ['bid', 'ask', 'last', 'volume', 'ticks'];

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
   Quote ≡ z.infer<typeof quoteSchema> — the connector's record type.      */

export type Quote = z.infer<typeof quoteSchema>;
export type MarketStats = z.infer<typeof marketStatsSchema>;
export type ScreenHit = z.infer<typeof screenHitSchema>;

/* ── Shared memory contract ───────────────────────────────────────────────
   10k × 48B quote records + a structured stats object the worker publishes
   for the main thread to observe reactively.                               */

export const marketMemory = defineSharedMemory({
  quotes: field.list({ schema: quoteSchema, count: 10_000 }),
  stats: field.object({ maxBytes: 2048, schema: marketStatsSchema }),
}, { codec: msgpackrCodec });
