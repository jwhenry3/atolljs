/**
 * 'dial' — the Svelte micro-frontend's public contract. See
 * counter.contract.ts for the model.
 */
import { z } from '@atolljs/core';
import { defineIslandContract } from '@atolljs/islands';

export const dialContract = defineIslandContract({
  app: 'dial',
  props: z.object({
    label: z.string().optional(),
    value: z.number().optional(),
  }),
  events: {
    changed: z.object({ value: z.number() }),
  },
  worker: () =>
    new Worker(new URL('../worker/dial.worker.ts', import.meta.url), { type: 'module' }),
});

export default dialContract;
