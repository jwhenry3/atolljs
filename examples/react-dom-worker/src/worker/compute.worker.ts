/**
 * Compute worker: the ops console's heavy work, with NO React and no
 * islands runtime. Island workers spawn it with `connectSubWorker` and say
 * how many they need:
 *
 *   - `workers: 1`: one dedicated worker, no pool. The export (row B) and
 *     the forecast model only need to be OFF the render thread.
 *   - `workers: 3`: a pool. Region recomputes are independent, so three of
 *     them run side by side (row C, "recompute all").
 *
 * Methods live under `ops.*` so their task ids never collide with the
 * island protocol's tasks (mount, dispatch, flush…) in the same registry.
 */
import { defineWorker } from '@atolljs/core';
import { aggregate } from './opsCompute';

export const computeWorker = defineWorker({
  services: {
    ops: {
      exportReport: (budgetMs: number) => aggregate(budgetMs),
      sla: (region: string, budgetMs: number) => aggregate(budgetMs, region),
      forecast: (budgetMs: number) => aggregate(budgetMs),
    },
  },
});

export type ComputeWorker = typeof computeWorker;
