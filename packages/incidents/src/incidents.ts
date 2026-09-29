import { connectWorker, scoped } from '@atolljs/core/sdk';
import { incidentsMemory } from './contract/memory.contracts';
// TYPE ONLY — the worker file registers handlers; nothing on the main
// thread may import it at runtime (the client proxies by method name).
import type { IncidentsWorker } from './worker/incidents.worker';

const log = scoped('incidents');

/**
 * The typed client over the incidents worker pool — spawning is lazy, so
 * importing this module never touches Worker (SSR-safe). The first method
 * call (or `incidents.start()`) brings the pool up; `terminate()` drops it
 * and the next call re-spawns.
 */
export const incidents = connectWorker<IncidentsWorker>({
  sharedMemory: incidentsMemory,
  worker: () =>
    new Worker(new URL('./worker/incidents.worker.ts', import.meta.url), { type: 'module' }),
  poolSize: 1,
});
export type IncidentsClient = typeof incidents;

/**
 * One-shot init: hand seeding to the worker, then kick off metrics
 * aggregation. Drive it through `toTask(initIncidents)` + `runOnce()` —
 * repeat triggers (StrictMode remounts, hot reloads) are ignored while
 * pending/settled.
 */
export const initIncidents = async () => {
  log.info('init: binding contract, dispatching seed task to worker');
  const ms = await incidents.seedIncidents();
  log.info(`init: worker seeded store in ${ms.toFixed(0)}ms`);
  void incidents.computeMetrics().catch(console.error);
  return ms;
};
