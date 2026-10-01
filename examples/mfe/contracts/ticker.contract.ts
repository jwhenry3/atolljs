/**
 * 'ticker' — the Solid micro-frontend's public contract. See
 * counter.contract.ts for the model.
 */
import { z } from '@atolljs/core';
import { defineIslandContract } from '@atolljs/islands';

export const tickerContract = defineIslandContract({
  app: 'ticker',
  props: z.object({
    label: z.string().optional(),
    intervalMs: z.number().optional(),
  }),
  events: {
    tick: z.object({ count: z.number() }),
  },
  worker: () =>
    new Worker(new URL('../worker/ticker.worker.ts', import.meta.url), { type: 'module' }),
});

export default tickerContract;
