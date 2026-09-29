import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '@atolljs/core/sdk';
import { AtollTask } from '../src/decorators';
import { registerAtollHandlers } from '../src/handlers';

class MathApi {
  @AtollTask()
  double(n: number) {
    return n * 2;
  }

  plain() {
    return 'not a task';
  }
}

class Stateful {
  n = 0;

  @AtollTask()
  bump(by = 1) {
    return (this.n += by);
  }
}

describe('registerAtollHandlers', () => {
  it('registers decorated methods bound to a fresh instance when given a class', async () => {
    registerAtollHandlers(MathApi);
    await expect(TaskRegistry.execute('MathApi.double', 4)).resolves.toBe(8);
  });

  it('registers only decorated methods', () => {
    registerAtollHandlers(MathApi);
    expect(TaskRegistry.getContract('MathApi.plain')).toBeUndefined();
  });

  it('binds to the given instance — constructor state is preserved', async () => {
    const counter = new Stateful();
    registerAtollHandlers(counter);
    await TaskRegistry.execute('Stateful.bump');
    await TaskRegistry.execute('Stateful.bump', 5);
    expect(counter.n).toBe(6); // state accumulated on OUR instance, not a fresh one
  });
});
