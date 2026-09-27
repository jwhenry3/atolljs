import { useEffect } from 'react';
import { useSharedValue, useTask } from '@jwhenry123/mesh-react';
import {
  incidents,
  incidentsMemory,
  initIncidents,
  type QueryArgs,
} from '@jwhenry123/mesh-incidents';

/**
 * Incident data layer: run init once, stream seedProgress/metrics out of
 * shared memory, and re-run the page query whenever the query spec changes.
 * The incidents client spawns its pool lazily on first call — nothing here
 * touches Worker at import time (SSR-safe). Stale page responses are
 * dropped by the task's latest-wins semantics.
 */
export function useIncidents(query: QueryArgs) {
  const seed = useTask(initIncidents);
  const page = useTask(incidents.queryIncidents);
  const seedProgress = useSharedValue(incidentsMemory, 'signals.seedProgress');
  const metrics = useSharedValue(incidentsMemory, 'state.metrics');

  useEffect(() => seed.runOnce(), []);
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
