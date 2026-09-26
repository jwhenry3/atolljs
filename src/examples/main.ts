import { createEffect, createRoot } from 'solid-js';
import { WorkerPool, reactive, type Logger } from '../sdk/index';
import { appTasks } from '../task.contracts';
import { appMemory } from '../memory.contracts';

export async function runDemo(log: Logger = console.log) {
  // Spawn worker pool using Vite worker URL syntax.
  // The pool owns the memory manager internally and binds the shared memory contract.
  const workerUrl = new URL('../app.worker.ts', import.meta.url);
  const pool = new WorkerPool({ workerUrl, sharedMemory: appMemory, poolSize: 2, tasks: appTasks });

  // Write into shared memory through the contract's typed connector
  const values = appMemory.values.read();
  values[0] = 42.5; // Direct zero-copy modification

  // Reactive connector: this effect re-runs whenever the worker writes lastResult
  const lastResult = reactive(appMemory.lastResult);
  const stopObserving = lastResult.observeRemote();
  const dispose = createRoot((dispose) => {
    createEffect(() => log('lastResult changed:', lastResult.get()));
    return dispose;
  });

  // Run task on background worker
  const sum = await pool.computeSum(0, 100_000);
  log('Worker Result:', sum.toLocaleString());

  stopObserving();
  dispose();
  pool.terminate();
}
