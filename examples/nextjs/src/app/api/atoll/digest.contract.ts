import { z } from 'zod';
import { defineSharedMemory, field, type TaskContract } from '@atolljs/core';

// The pool's own shared contract — a separate buffer from the browser demo's
// incidents memory. The route handler reads jobsDone directly (zero dispatch).
export const digestMemory = defineSharedMemory({
  jobsDone: field.number(),
});

const hashResult = z.object({
  hash: z.string(),
  rounds: z.number(),
  ms: z.number(),
  jobsDone: z.number(),
});

/** CPU-bound chained SHA-256 — executed inside a worker thread. */
export const HashDigest: TaskContract<
  [input?: string, rounds?: number],
  z.infer<typeof hashResult>
> = { taskId: 'digest.hash', resultSchema: hashResult };
