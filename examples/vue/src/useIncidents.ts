import { computed, watch, type Ref } from 'vue';
import { useSharedValue, useTask } from '@jwhenry123/mesh-vue';
import {
  getIncidentsPool,
  initIncidentsTask,
  incidentsMemory,
  queryIncidentsTask,
  type QueryArgs,
} from '@jwhenry123/mesh-incidents';

// Bind the contract and spawn the worker pool as soon as this module loads.
if (typeof window !== 'undefined') getIncidentsPool();

/**
 * Incident data layer: run init once, stream seedProgress/metrics out of
 * shared memory, and re-run the page query whenever the query spec changes.
 * Stale page responses are dropped by the task's latest-wins semantics.
 */
export function useIncidents(query: Ref<QueryArgs>) {
  const seed = useTask(initIncidentsTask);
  const page = useTask(queryIncidentsTask);
  const seedProgress = useSharedValue(incidentsMemory, 'seedProgress');
  const metrics = useSharedValue(incidentsMemory, 'metrics');

  initIncidentsTask.runOnce();
  watch(
    [query, () => seed.state.value.settled],
    () => {
      if (seed.state.value.settled) page.run(query.value);
    },
    { immediate: true }
  );

  return {
    ready: computed(() => seed.state.value.settled),
    seedProgress: computed(() => seedProgress.value ?? 0),
    metrics: computed(() => metrics.value ?? null),
    page: computed(() => page.state.value.data),
    roundTripMs: computed(() => page.state.value.elapsedMs),
    isFetching: computed(() => page.state.value.pending),
  };
}
