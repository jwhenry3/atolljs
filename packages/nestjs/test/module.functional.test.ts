import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { defineSharedMemory, field, TaskRegistry, WorkerPool } from '@jwhenry123/mesh/sdk';
import { InjectMeshPool } from '../src/injectPool';
import { MeshModule } from '../src/module';
import { MeshTask } from '../src/decorators';
import { getMeshPool } from '../src/pools';
import { runMeshWorker } from '../src/worker';
import { InProcessWorker } from '../../../test/inProcessWorker';

const mem = defineSharedMemory({ n: field.number() });
const newWorker = () => new InProcessWorker(new URL('https://t.test/w.js')) as unknown as Worker;

// A per-worker service holding injected state — runMeshWorker must bind
// handlers to the DI-resolved instance, not a fresh `new`.
@Injectable()
class WorkerState {
  public n = 0;
}

@Injectable()
class MeshService {
  constructor(@Inject(WorkerState) private readonly state: WorkerState) {}

  @MeshTask({ pool: 'fn' })
  accumulate(by = 1) {
    this.state.n += by;
    return this.state.n;
  }
}

@Module({ providers: [WorkerState, MeshService] })
class WorkerBoundary {}

@Injectable()
class ApiConsumer {
  constructor(@InjectMeshPool('fn') readonly pool: WorkerPool) {}
}

@Module({
  imports: [
    MeshModule.forRoot({
      pools: [{ name: 'fn', sharedMemory: mem, poolSize: 1, createWorker: newWorker }],
    }),
    WorkerBoundary,
  ],
  providers: [ApiConsumer],
})
class TestApp {}

describe('MeshModule.forRoot', () => {
  it('makes pools injectable and registers them for @MeshTask dispatch', async () => {
    const app = await NestFactory.createApplicationContext(TestApp, { logger: false });
    try {
      const consumer = app.get(ApiConsumer);
      expect(consumer.pool).toBeInstanceOf(WorkerPool);
      expect(getMeshPool('fn')).toBe(consumer.pool); // visible to @MeshTask dispatch

      const svc = app.get(MeshService);
      // runMeshWorker hasn't run — no handler registered, so dispatch rejects
      await expect(svc.accumulate(1)).rejects.toThrow(/not found/);
    } finally {
      await app.close();
    }
    expect(getMeshPool('fn')).toBeUndefined(); // lifecycle provider unregistered it
  });
});

describe('runMeshWorker', () => {
  it('boots a Nest context and binds @MeshTask handlers to DI instances', async () => {
    const app = await runMeshWorker(WorkerBoundary);
    try {
      // The handler ran against the DI-resolved MeshService — its injected
      // WorkerState accumulated across calls.
      await expect(TaskRegistry.execute('MeshService.accumulate', 2)).resolves.toBe(2);
      await expect(TaskRegistry.execute('MeshService.accumulate', 5)).resolves.toBe(7);
      expect(app.get(WorkerState).n).toBe(7);
    } finally {
      await app.close();
    }
  });

  it('completes the RPC illusion: caller dispatches, DI instance executes', async () => {
    InProcessWorker.created = [];
    const app = await NestFactory.createApplicationContext(TestApp, { logger: false });
    try {
      // Stand up the worker side: a real Nest context registers handlers.
      const workerApp = await runMeshWorker(WorkerBoundary);
      try {
        const caller = app.get(MeshService);
        // Caller-side invocation crosses the (in-process) worker boundary and
        // lands on the worker context's DI instance.
        await expect(caller.accumulate(3)).resolves.toBe(3);
        await expect(caller.accumulate(4)).resolves.toBe(7);
        expect(workerApp.get(WorkerState).n).toBe(7);
        expect(app.get(WorkerState).n).toBe(0); // caller's own context untouched
        expect(InProcessWorker.created[0].executed).toHaveLength(2);
      } finally {
        await workerApp.close();
      }
    } finally {
      await app.close();
    }
  });
});
