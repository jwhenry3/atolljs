import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskRegistry, type TaskContract } from '@jwhenry123/mesh/sdk';
import { getMeshTaskMeta, MeshTask } from '../src/decorators';
import { getMeshPool, registerMeshPool, unregisterMeshPool } from '../src/pools';

class Api {
  localRuns = 0;

  @MeshTask()
  hello(name: string) {
    this.localRuns++;
    return `hi ${name}`;
  }

  @MeshTask({ pool: 'compute' })
  heavy(x: number) {
    this.localRuns++;
    return x * 2;
  }

  @MeshTask('custom-id')
  custom() {
    return 'c';
  }

  @MeshTask({ taskId: 'contract-id' } as TaskContract)
  contracted() {
    return 'k';
  }
}

const proto = Api.prototype;
const fakePool = (result: unknown) => ({ runTask: vi.fn(async () => result) }) as any;

afterEach(() => {
  for (const name of ['default', 'compute']) unregisterMeshPool(name);
});

describe('@MeshTask metadata', () => {
  it('derives taskId as Class.method and defaults to the "default" pool', () => {
    const meta = getMeshTaskMeta(proto, 'hello');
    expect(meta?.contract.taskId).toBe('Api.hello');
    expect(meta?.pool).toBe('default');
    expect(meta?.original).toBeTypeOf('function');
  });

  it('honors an explicit pool name', () => {
    expect(getMeshTaskMeta(proto, 'heavy')?.pool).toBe('compute');
  });

  it('honors a string task id', () => {
    expect(getMeshTaskMeta(proto, 'custom')?.contract.taskId).toBe('custom-id');
  });

  it('reuses a TaskContract — including its schemas — verbatim', () => {
    expect(getMeshTaskMeta(proto, 'contracted')?.contract.taskId).toBe('contract-id');
  });
});

describe('@MeshTask dispatch', () => {
  it('runs the original body locally when no pool is registered', async () => {
    const api = new Api();
    await expect(api.hello('mesh')).resolves.toBe('hi mesh');
    expect(api.localRuns).toBe(1);
  });

  it('dispatches through the named pool instead of running locally', async () => {
    const pool = fakePool('from-worker');
    registerMeshPool('compute', pool as any);
    const api = new Api();

    await expect(api.heavy(21)).resolves.toBe('from-worker');
    expect(pool.runTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'Api.heavy' }),
      21,
    );
    expect(api.localRuns).toBe(0); // the main-thread body never ran
  });

  it('dispatches to the "default" pool by default', async () => {
    const pool = fakePool('ok');
    registerMeshPool('default', pool as any);
    await expect(new Api().custom()).resolves.toBe('ok');
    expect(pool.runTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'custom-id' }));
  });
});

describe('@MeshTask on the main thread', () => {
  it('does not auto-register TaskRegistry handlers (worker-side only)', () => {
    expect(TaskRegistry.getContract('Api.hello')).toBeUndefined();
  });
});
