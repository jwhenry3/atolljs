import { defineSharedMemory, field } from '@jwhenry123/mesh/sdk';

/**
 * The doorbell. One counter the worker bumps after every commit — the main
 * thread observe()s it (Atomics.waitAsync underneath) and flushes the op
 * queue on each tick. Ops themselves still ride postMessage; shared memory
 * only replaces the flush() poll with a push.
 */
export const renderMemory = defineSharedMemory({
  opsVersion: field.number(),
});
