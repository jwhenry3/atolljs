import { defineSharedMemory, field } from '@jwhenry123/mesh/sdk';
import type { TaskContract } from '@jwhenry123/mesh/sdk';
import { z } from 'zod';

// The contract is defined once and imported by BOTH threads — the pool binds
// it on the main thread, the worker bootstrap binds it inside each worker.
export const demoMemory = defineSharedMemory({
  counter: field.number(),
  ops: field.number(),
});

export const AddDelta: TaskContract<[delta: number], number> = {
  taskId: 'demo-add',
  argsSchema: z.tuple([z.number()]),
  resultSchema: z.number(),
};

export const Ping: TaskContract<[], string> = { taskId: 'demo-ping' };
