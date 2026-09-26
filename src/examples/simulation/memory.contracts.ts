import { z } from 'zod';
import { msgpackCodec } from '../../sdk/contract/msgpackCodec';
import { defineSharedMemory, field } from '../../sdk/contract/sharedMemory';

export const entitySchema = z.object({
  id: z.number(),
  name: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  velocity: z.object({ x: z.number(), y: z.number() }),
  active: z.boolean(),
});

export type Entity = z.infer<typeof entitySchema>;

/**
 * Shared memory contract for the simulation example — a structured world state
 * that both threads read and mutate through the same typed connectors.
 */
export const simMemory = defineSharedMemory({
  entities: field.array(8192, z.array(entitySchema)),
  tick: field.number(),
  status: field.string(64),
  stats: field.object(256, z.object({
    ticks: z.number(),
    movedLastTick: z.number(),
    updatedBy: z.string(),
  })),
}, { codec: msgpackCodec });
