import { TaskRegistry } from './sdk/worker/registry';
import { ComputeSum } from './task.contracts';
import { appMemory } from './memory.contracts';
import './sdk/worker/workerBootstrap'; // Wires up message listeners

// Register a compute-intensive task over the shared memory
TaskRegistry.register(ComputeSum, (start, end) => {
  const view = appMemory.values.read();
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += view[i];
  }
  appMemory.lastResult.write({ sum, computedBy: 'worker' });
  return sum;
});
