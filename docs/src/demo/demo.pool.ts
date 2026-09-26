import { defineTask, WorkerPool } from '@jwhenry123/mesh/sdk';
import { AddDelta, demoMemory, Ping } from './demo.contract';

function createDemoPool() {
  return new WorkerPool({
    // Inline new Worker(new URL(..., import.meta.url)) so every bundler's
    // worker transform can see the entry point.
    createWorker: () => new Worker(new URL('./demo.worker.ts', import.meta.url), { type: 'module' }),
    sharedMemory: demoMemory,
    poolSize: 1,
    // Keys become first-class pool methods: pool.addDelta(n) / pool.ping().
    tasks: { addDelta: AddDelta, ping: Ping },
  });
}

type DemoPool = ReturnType<typeof createDemoPool>;
let pool: DemoPool | null = null;
export function getDemoPool(): DemoPool {
  return (pool ??= createDemoPool());
}

// AsyncTask wrappers — latest-wins runs with data/pending/elapsedMs snapshots.
export const pingTask = defineTask<void, string>(() => getDemoPool().ping());
export const addTask = defineTask((delta: number) => getDemoPool().addDelta(delta));
