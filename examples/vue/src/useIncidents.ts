import { computed, watch, type Ref } from 'vue';
import { useSharedValue, useTask } from '@jwhenry123/mesh-vue';
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
 */
export function useIncidents(query: Ref<QueryArgs>) {
  const seed = useTask(initIncidents);
  const page = useTask(incidents.queryIncidents);
  const seedProgress = useSharedValue(incidentsMemory, 'signals.seedProgress');
  const metrics = useSharedValue(incidentsMemory, 'state.metrics');

  seed.runOnce();
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
