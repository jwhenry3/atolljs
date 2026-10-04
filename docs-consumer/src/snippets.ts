// Shared atoll quickstart files: the counter's memory/worker/connect trio is
// identical for every framework, so it lives once here and feeds both the
// top-level Quickstart page and each framework's quickstart sub-page.
// Only the install command and the binding step differ per framework.

export const SHARED_MEMORY = `import { defineSharedMemory, field } from '@atolljs/core';

export const counterMemory = defineSharedMemory({
  count: field.number(),
});`;

export const SHARED_WORKER = `import { defineWorker } from '@atolljs/core';
import { counterMemory } from './counter.memory';

// defineWorker wires the message loop and registers every method.
// Plain functions type the client from their signature.
export const counterWorker = defineWorker({
  sharedMemory: counterMemory,
  methods: {
    increment(delta: number) {
      const next = counterMemory.count.read() + delta;
      counterMemory.count.write(next);  // write in place: no postMessage
      return next;
    },
  },
});
export type CounterWorker = typeof counterWorker;`;

export const SHARED_CONNECT = `import { connectWorker } from '@atolljs/core';
import { counterMemory } from './counter.memory';
import type { CounterWorker } from './counter.worker';  // no worker code in this bundle

export const counter = connectWorker<CounterWorker>({
  sharedMemory: counterMemory,
  // Inline new Worker(new URL(..., import.meta.url)): every bundler's
  // worker transform can see the entry point this way.
  worker: () => new Worker(new URL('./counter.worker.ts', import.meta.url), { type: 'module' }),
  poolSize: 'auto',   // navigator.hardwareConcurrency, or pass a number
});
// counter.increment(1) → Promise<number>. The pool spawns on first call
// (SSR-safe to import); counter.terminate() tears it down.`;
