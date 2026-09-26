import { TaskRegistry } from '../../sdk/worker/registry';
import { Tick } from './task.contracts';
import { simMemory } from './memory.contracts';
import '../../sdk/worker/workerBootstrap'; // Wires up message listeners

// Advances every active entity by its velocity. The worker reads and writes
// the same structured shared state as the main thread — via the contract's
// connectors, so both sides agree on layout and schema.
TaskRegistry.register(Tick, (steps) => {
  const entities = simMemory.entities.read() ?? [];
  let moved = 0;
  for (const entity of entities) {
    if (!entity.active) continue;
    entity.position.x += entity.velocity.x * steps;
    entity.position.y += entity.velocity.y * steps;
    moved++;
  }

  simMemory.entities.write(entities);
  const ticks = simMemory.tick.read() + steps;
  simMemory.tick.write(ticks);
  simMemory.stats.write({ ticks, movedLastTick: moved, updatedBy: 'worker' });
  simMemory.status.write(`tick ${ticks} complete`);
  return moved;
});
