import { WorkerPool } from '@jwhenry123/mesh/sdk';
import { incidentsMemory } from './contract/memory.contracts';
import { ComputeMetrics, QueryIncidents, SeedIncidents } from './contract/task.contracts';

export const incidentsTasks = {
  seedIncidents: SeedIncidents,
  queryIncidents: QueryIncidents,
  computeMetrics: ComputeMetrics,
};

function createIncidentsPool() {
  return new WorkerPool({
    createWorker: () =>
      new Worker(new URL('./worker/incidents.worker.ts', import.meta.url), { type: 'module' }),
    sharedMemory: incidentsMemory,
    poolSize: 1,
    tasks: incidentsTasks,
  });
}

export type IncidentsPool = ReturnType<typeof createIncidentsPool>;

let pool: IncidentsPool | null = null;
export function getIncidentsPool(): IncidentsPool {
  return (pool ??= createIncidentsPool());
}
