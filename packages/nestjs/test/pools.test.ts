import { describe, expect, it } from 'vitest';
import { defineSharedMemory, field, WorkerPool } from '@jwhenry123/mesh/sdk';
import {
  buildMeshPool,
  getMeshPool,
  getMeshPoolToken,
  registerMeshPool,
  unregisterMeshPool,
} from '../src/pools';
import { InProcessWorker } from '../../../test/inProcessWorker';

const mem = () => defineSharedMemory({ n: field.number() });

describe('pool registry', () => {
  it('derives MESH_POOL:<name> tokens', () => {
    expect(getMeshPoolToken()).toBe('MESH_POOL:default');
    expect(getMeshPoolToken('incidents')).toBe('MESH_POOL:incidents');
  });

  it('registers, resolves, and unregisters pools', () => {
    const pool = { marker: true } as unknown as WorkerPool;
    registerMeshPool('x', pool);
    expect(getMeshPool('x')).toBe(pool);
    unregisterMeshPool('x');
    expect(getMeshPool('x')).toBeUndefined();
    expect(getMeshPool()).toBeUndefined(); // default never registered
  });
});

describe('buildMeshPool', () => {
  it('requires workerFile or createWorker', () => {
    expect(() => buildMeshPool({ name: 'empty', sharedMemory: mem() })).toThrow(/workerFile or createWorker/);
  });

  it('builds a real WorkerPool through the provided factory', () => {
    const spawnLog: InProcessWorker[] = [];
    const pool = buildMeshPool({
      name: 't',
      sharedMemory: mem(),
      poolSize: 2,
      createWorker: () => {
        const w = new InProcessWorker(new URL('https://t.test/w.js'));
        spawnLog.push(w);
        return w as unknown as Worker;
      },
    });
    expect(pool).toBeInstanceOf(WorkerPool);
    expect(spawnLog).toHaveLength(2);
    pool.terminate();
    expect(spawnLog.every((w) => w.terminated)).toBe(true);
  });
});
