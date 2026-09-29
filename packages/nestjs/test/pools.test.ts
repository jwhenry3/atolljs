import { describe, expect, it } from 'vitest';
import { defineSharedMemory, field, WorkerPool } from '@atolljs/core';
import {
  buildAtollPool,
  getAtollPool,
  getAtollPoolToken,
  registerAtollPool,
  unregisterAtollPool,
} from '../src/pools';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';

const mem = () => defineSharedMemory({ n: field.number() });

describe('pool registry', () => {
  it('derives ATOLL_POOL:<name> tokens', () => {
    expect(getAtollPoolToken()).toBe('ATOLL_POOL:default');
    expect(getAtollPoolToken('incidents')).toBe('ATOLL_POOL:incidents');
  });

  it('registers, resolves, and unregisters pools', () => {
    const pool = { marker: true } as unknown as WorkerPool;
    registerAtollPool('x', pool);
    expect(getAtollPool('x')).toBe(pool);
    unregisterAtollPool('x');
    expect(getAtollPool('x')).toBeUndefined();
    expect(getAtollPool()).toBeUndefined(); // default never registered
  });
});

describe('buildAtollPool', () => {
  it('requires workerFile or createWorker', () => {
    expect(() => buildAtollPool({ name: 'empty', sharedMemory: mem() })).toThrow(/workerFile or createWorker/);
  });

  it('builds a real WorkerPool through the provided factory', () => {
    const spawnLog: InProcessWorker[] = [];
    const pool = buildAtollPool({
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
