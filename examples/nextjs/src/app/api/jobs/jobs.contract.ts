import { z } from 'zod';
import { defineSharedMemory, field, type TaskContract } from '@atolljs/core';

/**
 * Queue counters live in shared memory: the POST handler writes `queued`
 * on the API thread before dispatching, workers write `completed`/`failed`
 * as each job settles — so GET can report progress without a single
 * postMessage round-trip.
 */
export const jobsMemory = defineSharedMemory({
  queued: field.number(),
  completed: field.number(),
  failed: field.number(),
  lastMs: field.number(),
});

const jobResult = z.object({
  id: z.number(),
  ms: z.number(),
  completed: z.number(),
});

export const ProcessJob: TaskContract<
  [id: number, workMs?: number],
  z.infer<typeof jobResult>
> = {
  taskId: 'jobs.process',
  resultSchema: jobResult,
};
