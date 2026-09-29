import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { defineSharedMemory, field, setLogSink, TaskRegistry, WorkerPool, type LogEntry } from '@atolljs/core/sdk';
import { InjectAtollPool } from '../src/injectPool';
import { AtollModule } from '../src/module';
import { AtollTask } from '../src/decorators';
import { getAtollPool } from '../src/pools';
import { runAtollWorker } from '../src/worker';
import { InProcessWorker } from '@atolljs/core/sdk/testing/inProcessWorker';

const mem = defineSharedMemory({ n: field.number() });
const newWorker = () => new InProcessWorker(new URL('https://t.test/w.js')) as unknown as Worker;

// A per-worker service holding injected state — runAtollWorker must bind
// handlers to the DI-resolved instance, not a fresh `new`.
@Injectable()
class WorkerState {
  public n = 0;
}

@Injectable()
class AtollService {
  constructor(@Inject(WorkerState) private readonly state: WorkerState) {}

  @AtollTask({ pool: 'fn' })
  accumulate(by = 1) {
    this.state.n += by;
    return this.state.n;
  }
}

@Module({ providers: [WorkerState, AtollService] })
class WorkerBoundary {}

@Injectable()
class ApiConsumer {
  constructor(@InjectAtollPool('fn') readonly pool: WorkerPool) {}
}

@Module({
  imports: [
    AtollModule.forRoot({
      pools: [{ name: 'fn', sharedMemory: mem, poolSize: 1, createWorker: newWorker }],
    }),
    WorkerBoundary,
  ],
  providers: [ApiConsumer],
})
class TestApp {}

describe('AtollModule.forRoot', () => {
  it('makes pools injectable and registers them for @AtollTask dispatch', async () => {
    const app = await NestFactory.createApplicationContext(TestApp, { logger: false });
    try {
      const consumer = app.get(ApiConsumer);
      expect(consumer.pool).toBeInstanceOf(WorkerPool);
      expect(getAtollPool('fn')).toBe(consumer.pool); // visible to @AtollTask dispatch

      const svc = app.get(AtollService);
      // runAtollWorker hasn't run — no handler registered, so dispatch rejects
      await expect(svc.accumulate(1)).rejects.toThrow(/not found/);
    } finally {
      await app.close();
    }
    expect(getAtollPool('fn')).toBeUndefined(); // lifecycle provider unregistered it
  });
});

describe('runAtollWorker', () => {
  it('boots a Nest context and binds @AtollTask handlers to DI instances', async () => {
    const app = await runAtollWorker(WorkerBoundary);
    try {
      // The handler ran against the DI-resolved AtollService — its injected
      // WorkerState accumulated across calls.
      await expect(TaskRegistry.execute('AtollService.accumulate', 2)).resolves.toBe(2);
      await expect(TaskRegistry.execute('AtollService.accumulate', 5)).resolves.toBe(7);
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
      const workerApp = await runAtollWorker(WorkerBoundary);
      try {
        const caller = app.get(AtollService);
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

describe('AtollModule.registerPool', () => {
  it('registers the pool inside the feature module and re-exports its token', async () => {
    InProcessWorker.created = [];
    const entries: LogEntry[] = [];
    setLogSink((e) => entries.push(e));
    try {
      @Injectable()
      class FeatService {
        @AtollTask({ pool: 'feat' })
        work() {
          return 'feat';
        }
      }

      @Injectable()
      class FeatConsumer {
        constructor(@InjectAtollPool('feat') readonly pool: WorkerPool) {}
      }

      // The feature module owns its worker domain — pool config lives here,
      // not at the root; the token is re-exported via `exports: [AtollModule]`.
      @Module({
        imports: [
          AtollModule.registerPool({
            name: 'feat',
            sharedMemory: mem,
            poolSize: 1,
            worker: () => new InProcessWorker(new URL('https://t.test/f.js')) as unknown as Worker,
          }),
        ],
        providers: [FeatService],
        exports: [AtollModule, FeatService],
      })
      class FeatureModule {}

      @Module({ imports: [AtollModule.forRoot(), FeatureModule], providers: [FeatConsumer] })
      class FeatApp {}

      const app = await NestFactory.createApplicationContext(FeatApp, { logger: false });
      try {
        const pool = app.get(FeatConsumer).pool;
        expect(pool).toBeInstanceOf(WorkerPool);
        expect(getAtollPool('feat')).toBe(pool);
        // Pool wiring ran without a validator warning — 'feat' was registered.
        expect(entries.every((e) => !e.message.includes('"feat"'))).toBe(true);
      } finally {
        await app.close();
      }
      expect(getAtollPool('feat')).toBeUndefined();
      expect(InProcessWorker.created[0].terminated).toBe(true);
    } finally {
      setLogSink(null);
    }
  });
});

describe('AtollModule async registration', () => {
  it('forRootAsync resolves pool config through injected dependencies', async () => {
    InProcessWorker.created = [];
    const POOL_SIZE = 'POOL_SIZE';
    // useFactory deps resolve through options.imports — same contract as
    // TypeOrmModule.forRootAsync({ imports: [ConfigModule] }).
    @Module({ providers: [{ provide: POOL_SIZE, useValue: 2 }], exports: [POOL_SIZE] })
    class SizeModule {}

    @Module({
      imports: [
        AtollModule.forRootAsync({
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
      expect(getAtollPool('async')).toBeInstanceOf(WorkerPool);
      expect(InProcessWorker.created).toHaveLength(2);
    } finally {
      await app.close();
    }
    expect(getAtollPool('async')).toBeUndefined();
  });

  it('registerPoolAsync keeps the ATOLL_POOL token injectable', async () => {
    const CFG = 'CFG';
    @Module({ providers: [{ provide: CFG, useValue: { size: 1 } }], exports: [CFG] })
    class CfgModule {}

    @Injectable()
    class AsyncConsumer {
      constructor(@InjectAtollPool('cfg') readonly pool: WorkerPool) {}
    }

    @Module({
      imports: [
        AtollModule.registerPoolAsync({
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
      exports: [AtollModule],
    })
    class AsyncFeature {}

    @Module({ imports: [AtollModule.forRoot(), AsyncFeature] })
    class AsyncRoot {}

    const app = await NestFactory.createApplicationContext(AsyncRoot, { logger: false });
    try {
      const featCtx = app.get(AsyncConsumer, { strict: false });
      expect(featCtx.pool).toBeInstanceOf(WorkerPool);
      expect(getAtollPool('cfg')).toBe(featCtx.pool);
    } finally {
      await app.close();
    }
  });
});

describe('AtollPoolValidator', () => {
  it('warns when an @AtollTask targets a pool nothing registered', async () => {
    const entries: LogEntry[] = [];
    setLogSink((e) => entries.push(e));
    try {
      @Injectable()
      class MissingPoolService {
        @AtollTask({ pool: 'missing' })
        work() {
          return 'local';
        }
      }

      @Module({ imports: [AtollModule.forRoot()], providers: [MissingPoolService] })
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
