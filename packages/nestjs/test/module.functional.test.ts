import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { defineSharedMemory, field, setLogSink, TaskRegistry, WorkerPool, type LogEntry } from '@jwhenry123/mesh/sdk';
import { InjectMeshPool } from '../src/injectPool';
import { MeshModule } from '../src/module';
import { MeshTask } from '../src/decorators';
import { getMeshPool } from '../src/pools';
import { runMeshWorker } from '../src/worker';
import { InProcessWorker } from '@jwhenry123/mesh/sdk/testing/inProcessWorker';

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

describe('MeshModule.registerPool', () => {
  it('registers the pool inside the feature module and re-exports its token', async () => {
    InProcessWorker.created = [];
    const entries: LogEntry[] = [];
    setLogSink((e) => entries.push(e));
    try {
      @Injectable()
      class FeatService {
        @MeshTask({ pool: 'feat' })
        work() {
          return 'feat';
        }
      }

      @Injectable()
      class FeatConsumer {
        constructor(@InjectMeshPool('feat') readonly pool: WorkerPool) {}
      }

      // The feature module owns its worker domain — pool config lives here,
      // not at the root; the token is re-exported via `exports: [MeshModule]`.
      @Module({
        imports: [
          MeshModule.registerPool({
            name: 'feat',
            sharedMemory: mem,
            poolSize: 1,
            worker: () => new InProcessWorker(new URL('https://t.test/f.js')) as unknown as Worker,
          }),
        ],
        providers: [FeatService],
        exports: [MeshModule, FeatService],
      })
      class FeatureModule {}

      @Module({ imports: [MeshModule.forRoot(), FeatureModule], providers: [FeatConsumer] })
      class FeatApp {}

      const app = await NestFactory.createApplicationContext(FeatApp, { logger: false });
      try {
        const pool = app.get(FeatConsumer).pool;
        expect(pool).toBeInstanceOf(WorkerPool);
        expect(getMeshPool('feat')).toBe(pool);
        // Pool wiring ran without a validator warning — 'feat' was registered.
        expect(entries.every((e) => !e.message.includes('"feat"'))).toBe(true);
      } finally {
        await app.close();
      }
      expect(getMeshPool('feat')).toBeUndefined();
      expect(InProcessWorker.created[0].terminated).toBe(true);
    } finally {
      setLogSink(null);
    }
  });
});

describe('MeshModule async registration', () => {
  it('forRootAsync resolves pool config through injected dependencies', async () => {
    InProcessWorker.created = [];
    const POOL_SIZE = 'POOL_SIZE';
    // useFactory deps resolve through options.imports — same contract as
    // TypeOrmModule.forRootAsync({ imports: [ConfigModule] }).
    @Module({ providers: [{ provide: POOL_SIZE, useValue: 2 }], exports: [POOL_SIZE] })
    class SizeModule {}

    @Module({
      imports: [
        MeshModule.forRootAsync({
          imports: [SizeModule],
          useFactory: (size: number) => ({
            pools: [{ name: 'async', sharedMemory: mem, poolSize: size, createWorker: newWorker }],
          }),
          inject: [POOL_SIZE],
        }),
      ],
    })
    class AsyncApp {}

    const app = await NestFactory.createApplicationContext(AsyncApp, { logger: false });
    try {
      expect(getMeshPool('async')).toBeInstanceOf(WorkerPool);
      expect(InProcessWorker.created).toHaveLength(2);
    } finally {
      await app.close();
    }
    expect(getMeshPool('async')).toBeUndefined();
  });

  it('registerPoolAsync keeps the MESH_POOL token injectable', async () => {
    const CFG = 'CFG';
    @Module({ providers: [{ provide: CFG, useValue: { size: 1 } }], exports: [CFG] })
    class CfgModule {}

    @Injectable()
    class AsyncConsumer {
      constructor(@InjectMeshPool('cfg') readonly pool: WorkerPool) {}
    }

    @Module({
      imports: [
        MeshModule.registerPoolAsync({
          name: 'cfg',
          imports: [CfgModule],
          useFactory: (cfg: { size: number }) => ({
            sharedMemory: mem,
            poolSize: cfg.size,
            createWorker: newWorker,
          }),
          inject: [CFG],
        }),
      ],
      providers: [AsyncConsumer],
      exports: [MeshModule],
    })
    class AsyncFeature {}

    @Module({ imports: [MeshModule.forRoot(), AsyncFeature] })
    class AsyncRoot {}

    const app = await NestFactory.createApplicationContext(AsyncRoot, { logger: false });
    try {
      const featCtx = app.get(AsyncConsumer, { strict: false });
      expect(featCtx.pool).toBeInstanceOf(WorkerPool);
      expect(getMeshPool('cfg')).toBe(featCtx.pool);
    } finally {
      await app.close();
    }
  });
});

describe('MeshPoolValidator', () => {
  it('warns when an @MeshTask targets a pool nothing registered', async () => {
    const entries: LogEntry[] = [];
    setLogSink((e) => entries.push(e));
    try {
      @Injectable()
      class MissingPoolService {
        @MeshTask({ pool: 'missing' })
        work() {
          return 'local';
        }
      }

      @Module({ imports: [MeshModule.forRoot()], providers: [MissingPoolService] })
      class WarnApp {}

      const app = await NestFactory.createApplicationContext(WarnApp, { logger: false });
      await app.close();
      expect(
        entries.some(
          (e) =>
            e.level === 'warn' &&
            e.message.includes('unregistered pool') &&
            e.message.includes('"missing"'),
        ),
      ).toBe(true);
    } finally {
      setLogSink(null);
    }
  });
});
