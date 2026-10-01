/**
 * 'checkout' — the Angular micro-frontend's public contract. See
 * counter.contract.ts for the model.
 */
import { z } from '@atolljs/core';
import { defineIslandContract } from '@atolljs/islands';

export const checkoutContract = defineIslandContract({
  app: 'checkout',
  props: z.object({
    label: z.string().optional(),
    total: z.number(),
  }),
  events: {
    paid: z.object({ total: z.number() }),
  },
  worker: () =>
    new Worker(new URL('../worker/checkout.worker.ts', import.meta.url), { type: 'module' }),
});

export default checkoutContract;
