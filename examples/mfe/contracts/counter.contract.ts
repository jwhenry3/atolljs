/**
 * 'counter' — the React micro-frontend's public contract.
 *
 * This module is the ONLY file both threads import: it names the registry
 * app, declares the props/events wire shape, and carries the worker factory
 * so `lazyIsland(() => import('./counter.contract'))` is a self-contained
 * split point. It imports NO framework — any shell (React, Vue, Solid,
 * Svelte, Angular, or none) can mount it, and the React runtime only ever
 * exists inside the worker bundle.
 *
 * The worker entry (`../worker/counter.worker.tsx`) imports this same module
 * and attaches it to the app — props parse at mount/updateProps, declared
 * emit payloads parse at emit(). Drift between shell and worker fails
 * loudly instead of silently dropping fields.
 */
import { z } from '@atolljs/core';
import { defineIslandContract } from '@atolljs/islands';

export const counterContract = defineIslandContract({
  app: 'counter',
  props: z.object({ label: z.string().optional() }),
  events: {
    incremented: z.object({ count: z.number(), label: z.string() }),
  },
  worker: () =>
    new Worker(new URL('../worker/counter.worker.tsx', import.meta.url), { type: 'module' }),
});

export default counterContract;
