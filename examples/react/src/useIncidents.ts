import { useEffect } from 'react';
import { useSharedValue, useTask } from '@jwhenry123/mesh-react';
import {
  getIncidentsPool,
  initIncidentsTask,
  incidentsMemory,
  queryIncidentsTask,
  type QueryArgs,
} from '@jwhenry123/mesh-incidents';

// Connect the dots: bind the contract and spawn the worker pool as soon as
// this module loads on the client (guarded so SSR/prerender never touches Worker).
if (typeof window !== 'undefined') getIncidentsPool();

/**
 * Incident data layer: run init once, stream seedProgress/metrics out of
 * shared memory, and re-run the page query whenever the query spec changes.
 * Stale page responses are dropped by the task's latest-wins semantics.
 */
export function useIncidents(query: QueryArgs) {
  const seed = useTask(initIncidentsTask);
  const page = useTask(queryIncidentsTask);
  const seedProgress = useSharedValue(incidentsMemory, 'seedProgress');
  const metrics = useSharedValue(incidentsMemory, 'metrics');

  useEffect(() => initIncidentsTask.runOnce(), []);
  const ready = seed.settled;
  useEffect(() => {
    if (ready) page.run(query);
  }, [ready, query]);

  return {
    ready,
    seedProgress: seedProgress ?? 0,
    metrics: metrics ?? null,
    page: page.data,
    roundTripMs: page.elapsedMs,
    isFetching: page.pending,
  };
}
