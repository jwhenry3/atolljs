import { Worker } from 'node:worker_threads';
import { createNodePool, createNodeWorker } from '@atolljs/node';
import { jobsMemory, ProcessJob } from './jobs.contract';

const create = () => {
  const pool = createNodePool({
    sharedMemory: jobsMemory,
    poolSize: 'auto',
    tasks: { process: ProcessJob },
    createWorker: () =>
      createNodeWorker(
        process.env.ATOLL_JOBS_WORKER
          ? new Worker(process.env.ATOLL_JOBS_WORKER)
          : new Worker(new URL('./jobs.worker.ts', import.meta.url)),
      ),
  });
  return { pool, memory: jobsMemory };
};

export const getJobs = (): ReturnType<typeof create> => {
  const g = globalThis as { __atollJobs?: ReturnType<typeof create> };
  return (g.__atollJobs ??= create());
};
