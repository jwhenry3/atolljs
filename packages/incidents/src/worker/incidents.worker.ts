import { defineWorker } from '@atolljs/core/sdk';
import { incidentsMemory } from '../contract/memory.contracts';
import { computeMetrics } from '../service/computeMetrics';
import { queryIncidents } from '../service/queryIncidents';
import { seedIncidents } from '../service/seedIncidents';

/**
 * The whole worker entry: defineWorker wires the message handler (via its
 * workerBootstrap side-effect import) and registers every method — each
 * ServiceMethod unit under ../service/ contributes its wire schemas and
 * `run` implementation. The main thread imports only `IncidentsWorker`
 * (a type) and drives it through the connectWorker client.
 */
export const incidentsWorker = defineWorker({
  sharedMemory: incidentsMemory,
  methods: { seedIncidents, queryIncidents, computeMetrics },
});
export type IncidentsWorker = typeof incidentsWorker;
