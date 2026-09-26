import { z } from 'zod';
import { TaskContract } from '../../sdk/contract/types';

/**
 * Function contracts: what the worker exposes to the main thread.
 */
export const Tick: TaskContract<[steps: number], number> = {
  taskId: 'tick',
  argsSchema: z.tuple([z.number()]),
  resultSchema: z.number(),
};

/** Keys become first-class pool methods: pool.tick(2). */
export const simulationTasks = { tick: Tick };
