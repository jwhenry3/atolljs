import { sharedValue, taskState } from '@jwhenry123/mesh-svelte';
import {
  incidents,
  incidentsMemory,
  initIncidents,
  type QueryArgs,
} from '@jwhenry123/mesh-incidents';

/**
 * Incident data layer: run init once, stream seedProgress/metrics out of
 * shared memory, and re-run the page query whenever the query spec changes.
 * Stale page responses are dropped by the task's latest-wins semantics.
 * Runes-based — call once during component init.
 */
export function createIncidents(getQuery: () => QueryArgs) {
  const seed = taskState(initIncidents);
  const pageTask = taskState(incidents.queryIncidents);
  const seedProgress = sharedValue(incidentsMemory, 'signals.seedProgress');
  const metrics = sharedValue(incidentsMemory, 'state.metrics');

  seed.runOnce();
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
