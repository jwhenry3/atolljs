import { createEffect, createRoot } from 'solid-js';
import { WorkerPool, reactive, type Logger } from '../../sdk/index';
import { simulationTasks } from './task.contracts';
import { simMemory } from './memory.contracts';

const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export async function runDemo(log: Logger = console.log) {
  const workerUrl = new URL('./simulation.worker.ts', import.meta.url);
  const pool = new WorkerPool({ workerUrl, sharedMemory: simMemory, poolSize: 2, tasks: simulationTasks });

  // Main thread seeds the structured world state
  simMemory.status.write('seeding entities');
  simMemory.entities.write([
    { id: 1, name: 'alpha', position: { x: 0, y: 0 }, velocity: { x: 1.5, y: -0.5 }, active: true },
    { id: 2, name: 'beta', position: { x: 10, y: 4 }, velocity: { x: -1, y: 0.25 }, active: true },
    { id: 3, name: 'gamma', position: { x: -3, y: 8 }, velocity: { x: 0.5, y: 0.5 }, active: false },
  ]);

  // Reactively watch stats the worker publishes
  const stats = reactive(simMemory.stats);
  const stopObserving = stats.observeRemote();
  const dispose = createRoot((dispose) => {
    createEffect(() => {
      const s = stats.get();
      if (s) {
        log(`[reactive] tick ${fmtInt(s.ticks)}: ${fmtInt(s.movedLastTick)} entities moved by ${s.updatedBy}`);
      }
    });
    return dispose;
  });

  // Worker advances the world by 2 steps
  const moved1 = await pool.tick(2);
  log(`worker moved ${fmtInt(moved1)} entities`);

  // Main thread mutates the same structured state between ticks:
  // bounce alpha off a wall and wake up gamma
  const entities = simMemory.entities.read() ?? [];
  for (const entity of entities) {
    if (entity.name === 'alpha') entity.velocity.x *= -1;
    if (entity.name === 'gamma') entity.active = true;
  }
  simMemory.entities.write(entities);
  simMemory.status.write('main adjusted entities');

  // Worker ticks again, now with the main thread's changes
  const moved2 = await pool.tick(1);
  log(`worker moved ${fmtInt(moved2)} entities`);

  log('final entities:', simMemory.entities.read());
  log('tick:', simMemory.tick.read(), '| status:', simMemory.status.read());

  stopObserving();
  dispose();
  pool.terminate();
}
