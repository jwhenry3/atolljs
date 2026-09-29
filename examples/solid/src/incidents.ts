import { createEffect, type Accessor } from 'solid-js';
import { createSharedValue, createTask } from '@atolljs/solidjs';
import {
  incidents,
  incidentsMemory,
  initIncidents,
  type QueryArgs,
} from '@atolljs/incidents';

/**
 * Incident data layer: run init once, stream seedProgress/metrics out of
 * shared memory, and re-run the page query whenever the query spec changes.
 * Stale page responses are dropped by the task's latest-wins semantics.
 */
export function createIncidents(query: Accessor<QueryArgs>) {
  const seed = createTask(initIncidents);
  const page = createTask(incidents.queryIncidents);
  const seedProgress = createSharedValue(incidentsMemory, 'signals.seedProgress');
  const metrics = createSharedValue(incidentsMemory, 'state.metrics');

  seed.runOnce();
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
