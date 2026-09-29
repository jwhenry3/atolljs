// isMainThread is mocked false for this whole file — @AtollTask decorators take
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
import { z } from 'zod';
import {
  defineService,
  defineSharedMemory,
  field,
  TaskRegistry,
} from '@atolljs/core';
import { bindAtollWorkerInstance, AtollService, AtollTask } from '../src/decorators';
import { AtollModule } from '../src/module';
import { getAtollPoolToken } from '../src/pools';

const mem = defineSharedMemory({ n: field.number() });

class Dep {
  public n = 100;
}

@Injectable()
class WorkerService {
  constructor(private readonly dep: Dep) {}

  @AtollTask({ pool: 'p' })
  read() {
    return this.dep.n;
  }
}

describe('worker-side @AtollTask delegation', () => {
  it('handlers registered at decoration time delegate to the DI-bound instance', async () => {
    const di = new WorkerService(new Dep());
    bindAtollWorkerInstance(WorkerService, di);
    // The decorator auto-registered on class evaluation; the bound DI instance
    // is what actually executes — ctor deps resolve, not `new WorkerService()`.
    await expect(TaskRegistry.execute('WorkerService.read')).resolves.toBe(100);
  });

  it('falls back to a lazily-constructed instance when none is bound', async () => {
    class Unbound {
      @AtollTask({ pool: 'p' })
      read() {
        return 'lazy';
      }
    }
    await expect(TaskRegistry.execute('Unbound.read')).resolves.toBe('lazy');
  });
});

describe('worker-side @AtollService delegation', () => {
  const calcService = defineService('calc', {
    read: { resultSchema: z.number() }, // () => number — inferred
    unbound: {}, // declared but not implemented below
  });

  @Injectable()
  @AtollService(calcService, { pool: 'p' })
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
    bindAtollWorkerInstance(CalcService, di);
    await expect(TaskRegistry.execute('calc.read')).resolves.toBe(101);
  });

  it('leaves service methods the class does not implement unregistered', async () => {
    await expect(TaskRegistry.execute('calc.unbound')).rejects.toThrow(
      /handler not found/i,
    );
  });
});

describe('contract-less @AtollService({ pool })', () => {
  @Injectable()
  @AtollService({ pool: 'p' })
  class Analytics {
    constructor(private readonly dep: Dep) {}

    hotspots(limit = 10) {
      return this.dep.n + limit;
    }

    rollup() {
      return 'all';
    }
  }

  it('registers every method as `ClassName.method` bound to the DI instance', async () => {
    bindAtollWorkerInstance(Analytics, new Analytics(new Dep()));
    await expect(TaskRegistry.execute('Analytics.hotspots', 5)).resolves.toBe(105);
    await expect(TaskRegistry.execute('Analytics.rollup')).resolves.toBe('all');
  });
});

describe('pool providers inside a worker context', () => {
  it('resolve to null instead of spawning a nested pool', async () => {
    // worker() would throw if invoked — proves the provider short-circuits
    // before any worker construction inside a worker.
    @Module({
      imports: [
        AtollModule.registerPool({
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
      expect(app.get(getAtollPoolToken('nested'))).toBeNull();
    } finally {
      await app.close();
    }
  });
});
