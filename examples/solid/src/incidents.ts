import { createEffect, type Accessor } from 'solid-js';
import { createSharedValue, createTask } from '@jwhenry123/mesh/solidjs';
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
 */
export function createIncidents(query: Accessor<QueryArgs>) {
  const seed = createTask(initIncidentsTask);
  const page = createTask(queryIncidentsTask);
  const seedProgress = createSharedValue(incidentsMemory, 'seedProgress');
  const metrics = createSharedValue(incidentsMemory, 'metrics');

  initIncidentsTask.runOnce();
  createEffect(() => {
    const q = query();
    if (seed.state().settled) page.run(q);
  });

  return {
    ready: () => seed.state().settled,
    seedProgress: () => seedProgress() ?? 0,
    metrics: () => metrics() ?? null,
    page: () => page.state().data,
    roundTripMs: () => page.state().elapsedMs,
    isFetching: () => page.state().pending,
  };
}
