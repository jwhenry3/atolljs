import { z } from 'zod';
import { TaskContract } from './sdk/contract/types';

/**
 * Function contracts: what the worker exposes to the main thread.
 * Each contract is the single source of truth for a task's id,
 * the datatype of the shared-memory region it operates on,
 * and its argument/result signature.
 */
export const ComputeSum: TaskContract<[start: number, end: number], number> = {
  taskId: 'compute-sum',
  dataType: 'Float64',
  argsSchema: z.tuple([z.number(), z.number()]),
  resultSchema: z.number(),
};

/** Keys become first-class pool methods: pool.computeSum(0, 100_000). */
export const appTasks = { computeSum: ComputeSum };
