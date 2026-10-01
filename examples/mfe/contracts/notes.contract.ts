/**
 * 'notes' — the Vue micro-frontend's public contract. See
 * counter.contract.ts for the model: shell-safe module, `z` wire schemas,
 * worker factory bundled in.
 */
import { z } from '@atolljs/core';
import { defineIslandContract } from '@atolljs/islands';

export const notesContract = defineIslandContract({
  app: 'notes',
  props: z.object({ title: z.string().optional() }),
  events: {
    noteAdded: z.object({ text: z.string(), total: z.number() }),
  },
  worker: () =>
    new Worker(new URL('../worker/notes.worker.ts', import.meta.url), { type: 'module' }),
});

export default notesContract;
