import { Worker } from 'node:worker_threads';
import { workerClient } from '@atolljs/core';
import { createNodePool, createNodeWorker } from '@atolljs/node';
import { incidentsMemory } from '@atolljs/incidents';
// Type-only — worker code must not leak into the server bundle.
import type { IncidentsWorker } from '@atolljs/incidents';

const create = () => {
  const pool = createNodePool({
    sharedMemory: incidentsMemory,
    poolSize: 2,
    createWorker: () =>
      createNodeWorker(
        process.env.ATOLL_INCIDENTS_WORKER
          ? new Worker(process.env.ATOLL_INCIDENTS_WORKER)
          : new Worker(new URL('./incidents.worker.ts', import.meta.url)),
      ),
  });
  // `memory` is the instance the pool bound — Next may compile this graph
  // twice, so routes must read it via the getter, not a fresh import of
  // '@atolljs/incidents' (which could be a second, unbound contract).
  return { pool, client: workerClient<IncidentsWorker>(pool), memory: incidentsMemory };
};

export const getIncidentsApi = (): ReturnType<typeof create> => {
  const g = globalThis as { __atollIncidents?: ReturnType<typeof create> };
  return (g.__atollIncidents ??= create());
};
