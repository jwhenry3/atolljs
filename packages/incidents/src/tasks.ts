import { defineTask, scoped } from '@jwhenry123/mesh/sdk';
import { getIncidentsPool } from './pool';
import type { QueryArgs } from './contract/memory.contracts';

const log = scoped('incidents');

/**
 * One-shot init: bind the contract, hand seeding to the worker pool, then kick
 * off metrics aggregation. Call via `initIncidentsTask.runOnce()` — repeat
 * calls (StrictMode remounts, hot reloads) are ignored while pending/settled.
 */
export const initIncidentsTask = defineTask<void, number>(async () => {
  log.info('init: binding contract, dispatching seed task to worker');
  const pool = getIncidentsPool();
  const seedMs = await pool.seedIncidents();
  log.info(`init: worker seeded store in ${seedMs.toFixed(0)}ms`);
  void pool.computeMetrics().catch(console.error);
  return seedMs;
});

/** One table page — latest-wins, so rapid filter changes drop stale results. */
export const queryIncidentsTask = defineTask((q: QueryArgs) => getIncidentsPool().queryIncidents(q));
