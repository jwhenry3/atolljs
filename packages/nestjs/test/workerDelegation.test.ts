// isMainThread is mocked false for this whole file — @MeshTask decorators take
// their worker branch, and pool providers resolve to null like they do inside
// a real worker's application context.
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:worker_threads', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:worker_threads')>();
  return { ...mod, isMainThread: false };
});

import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  defineService,
  defineSharedMemory,
  field,
  rpc,
  TaskRegistry,
} from '@jwhenry123/mesh/sdk';
import { bindMeshWorkerInstance, MeshService, MeshTask } from '../src/decorators';
import { MeshModule } from '../src/module';
import { getMeshPoolToken } from '../src/pools';

const mem = defineSharedMemory({ n: field.number() });

class Dep {
  public n = 100;
}

@Injectable()
class WorkerService {
  constructor(private readonly dep: Dep) {}

  @MeshTask({ pool: 'p' })
  read() {
    return this.dep.n;
  }
}

describe('worker-side @MeshTask delegation', () => {
  it('handlers registered at decoration time delegate to the DI-bound instance', async () => {
    const di = new WorkerService(new Dep());
    bindMeshWorkerInstance(WorkerService, di);
    // The decorator auto-registered on class evaluation; the bound DI instance
    // is what actually executes — ctor deps resolve, not `new WorkerService()`.
    await expect(TaskRegistry.execute('WorkerService.read')).resolves.toBe(100);
  });

  it('falls back to a lazily-constructed instance when none is bound', async () => {
    class Unbound {
      @MeshTask({ pool: 'p' })
      read() {
        return 'lazy';
      }
    }
    await expect(TaskRegistry.execute('Unbound.read')).resolves.toBe('lazy');
  });
});

describe('worker-side @MeshService delegation', () => {
  const calcService = defineService('calc', {
    read: rpc<[], number>(),
    unbound: rpc<[], string>(), // declared but not implemented below
  });

  @Injectable()
  @MeshService(calcService, { pool: 'p' })
  class CalcService {
    constructor(private readonly dep: Dep) {}

    read() {
      return this.dep.n + 1;
    }

    untouched() {
      return 'plain';
    }
  }

  it('registers service methods and delegates them to the DI-bound instance', async () => {
    const di = new CalcService(new Dep());
    bindMeshWorkerInstance(CalcService, di);
    await expect(TaskRegistry.execute('calc.read')).resolves.toBe(101);
  });

  it('leaves service methods the class does not implement unregistered', async () => {
    await expect(TaskRegistry.execute('calc.unbound')).rejects.toThrow(
      /handler not found/i,
    );
  });
});

describe('pool providers inside a worker context', () => {
  it('resolve to null instead of spawning a nested pool', async () => {
    // worker() would throw if invoked — proves the provider short-circuits
    // before any worker construction inside a worker.
    @Module({
      imports: [
        MeshModule.registerPool({
          name: 'nested',
          sharedMemory: mem,
          worker: () => {
            throw new Error('must not spawn');
          },
        }),
      ],
    })
    class WorkerFeature {}

    const app = await NestFactory.createApplicationContext(WorkerFeature, { logger: false });
    try {
      expect(app.get(getMeshPoolToken('nested'))).toBeNull();
    } finally {
      await app.close();
    }
  });
});
