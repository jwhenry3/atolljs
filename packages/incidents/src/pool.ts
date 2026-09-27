import { WorkerPool } from '@jwhenry123/mesh/sdk';
import { incidentsService } from './contract/incidents.service';
import { incidentsMemory } from './contract/memory.contracts';

/** The service's contracts as a TaskMap — same object, pool-config shape. */
export const incidentsTasks = incidentsService.tasks;

function createIncidentsPool() {
  return new WorkerPool({
    createWorker: () =>
      new Worker(new URL('./worker/incidents.worker.ts', import.meta.url), { type: 'module' }),
    sharedMemory: incidentsMemory,
    poolSize: 1,
    tasks: incidentsService.tasks,
  });
}

export type IncidentsPool = ReturnType<typeof createIncidentsPool>;

let pool: IncidentsPool | null = null;
export function getIncidentsPool(): IncidentsPool {
  return (pool ??= createIncidentsPool());
}
