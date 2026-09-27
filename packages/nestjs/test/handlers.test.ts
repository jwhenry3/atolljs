import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '@jwhenry123/mesh/sdk';
import { MeshTask } from '../src/decorators';
import { registerMeshHandlers } from '../src/handlers';

class MathApi {
  @MeshTask()
  double(n: number) {
    return n * 2;
  }

  plain() {
    return 'not a task';
  }
}

class Stateful {
  n = 0;

  @MeshTask()
  bump(by = 1) {
    return (this.n += by);
  }
}

describe('registerMeshHandlers', () => {
  it('registers decorated methods bound to a fresh instance when given a class', async () => {
    registerMeshHandlers(MathApi);
    await expect(TaskRegistry.execute('MathApi.double', 4)).resolves.toBe(8);
  });

  it('registers only decorated methods', () => {
    registerMeshHandlers(MathApi);
    expect(TaskRegistry.getContract('MathApi.plain')).toBeUndefined();
  });

  it('binds to the given instance — constructor state is preserved', async () => {
    const counter = new Stateful();
    registerMeshHandlers(counter);
    await TaskRegistry.execute('Stateful.bump');
    await TaskRegistry.execute('Stateful.bump', 5);
    expect(counter.n).toBe(6); // state accumulated on OUR instance, not a fresh one
  });
});
