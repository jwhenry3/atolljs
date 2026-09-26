import { scoped, TaskRegistry } from '@jwhenry123/mesh/sdk';
import '@jwhenry123/mesh/sdk/worker/workerBootstrap';
import { AddDelta, demoMemory, Ping } from './demo.contract';

const log = scoped('demo-worker');

// Worker-side writes go straight into shared memory — no postMessage.
// Main-thread `watch`/`observe` subscribers see them via the version counter.
TaskRegistry.register(AddDelta, (delta) => {
  const next = demoMemory.counter.read() + delta;
  demoMemory.counter.write(next);
  demoMemory.ops.write(demoMemory.ops.read() + 1);
  log.debug(`counter → ${next}`);
  return next;
});

TaskRegistry.register(Ping, () => `pong from worker @ t=${performance.now().toFixed(1)}ms`);
