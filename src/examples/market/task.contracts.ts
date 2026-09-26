import { z } from 'zod';
import type { TaskContract } from '../../sdk/contract/types';
import { marketStatsSchema, screenHitSchema } from './memory.contracts';

/* ── Task contracts — the functions this worker exposes ─────────────────── */

/** Ingest `ticks` random-walk price updates into the quote cache. Returns elapsed ms. */
export const FeedTicks: TaskContract<[ticks: number], number> = {
  taskId: 'mkt-feed',
  argsSchema: z.tuple([z.number()]),
  resultSchema: z.number(),
};

/** Scan the whole quote cache; return instruments matching the criteria. */
export const ScreenQuotes: TaskContract<[minVolume: number, minChangePct: number], z.infer<typeof screenHitSchema>[]> = {
  taskId: 'mkt-screen',
  argsSchema: z.tuple([z.number(), z.number()]),
  resultSchema: z.array(screenHitSchema),
};

/** Aggregate market breadth over the quote cache, publish stats to shared memory. */
export const PublishStats: TaskContract<[], z.infer<typeof marketStatsSchema>> = {
  taskId: 'mkt-publish-stats',
  resultSchema: marketStatsSchema,
};

/* ── Task map — baked into the pool, keys become method names ───────────── */

export const marketTasks = {
  feedTicks: FeedTicks,
  screenQuotes: ScreenQuotes,
  publishStats: PublishStats,
};
