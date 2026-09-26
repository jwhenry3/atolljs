import { sharedValue, taskState } from '@jwhenry123/mesh/svelte';
import {
  getIncidentsPool,
  initIncidentsTask,
  incidentsMemory,
  queryIncidentsTask,
  type QueryArgs,
} from '@jwhenry123/mesh/incidents';

// Bind the contract and spawn the worker pool as soon as this module loads.
if (typeof window !== 'undefined') getIncidentsPool();

/**
 * Incident data layer: run init once, stream seedProgress/metrics out of
 * shared memory, and re-run the page query whenever the query spec changes.
 * Stale page responses are dropped by the task's latest-wins semantics.
 * Runes-based — call once during component init.
 */
export function createIncidents(getQuery: () => QueryArgs) {
  const seed = taskState(initIncidentsTask);
  const pageTask = taskState(queryIncidentsTask);
  const seedProgress = sharedValue(incidentsMemory, 'seedProgress');
  const metrics = sharedValue(incidentsMemory, 'metrics');

  initIncidentsTask.runOnce();
  $effect(() => {
    const q = getQuery();
    if (seed.settled) pageTask.run(q);
  });

  return {
    get ready() {
      return seed.settled;
    },
    get seedProgress() {
      return seedProgress.value ?? 0;
    },
    get metrics() {
      return metrics.value ?? null;
    },
    get page() {
      return pageTask.data;
    },
    get roundTripMs() {
      return pageTask.elapsedMs;
    },
    get isFetching() {
      return pageTask.pending;
    },
  };
}
