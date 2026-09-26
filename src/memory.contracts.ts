import { z } from 'zod';
import { defineSharedMemory, field } from './sdk/contract/sharedMemory';

/**
 * Shared memory contract: the single source of truth for the layout and
 * datatypes of the shared buffer. Imported by both the main thread and
 * workers so both sides read and write memory identically.
 */
export const appMemory = defineSharedMemory({
  values: field.float64Array(100_000),
  lastResult: field.object(256, z.object({
    sum: z.number(),
    computedBy: z.string(),
  })),
});
