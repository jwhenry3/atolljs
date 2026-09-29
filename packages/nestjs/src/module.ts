import {
  DynamicModule,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Provider,
  type Type,
} from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { isMainThread } from 'node:worker_threads';
import { scoped, type WorkerPool } from '@atolljs/core';
import { getAtollTaskMeta } from './decorators';
import {
  buildAtollPool,
  getAtollPool,
  getAtollPoolToken,
  registerAtollPool,
  unregisterAtollPool,
  type AtollModuleOptions,
  type AtollPoolConfig,
} from './pools';

const ATOLL_OPTIONS = 'ATOLL_OPTIONS';
const moduleLog = scoped('atoll-nestjs');

type NamedPoolConfig = AtollPoolConfig & { name: string };

class AtollPoolLifecycle implements OnModuleDestroy {
  constructor(private readonly pools: Array<{ name: string; pool: WorkerPool | null }>) {}
  onModuleDestroy() {
    for (const { name, pool } of this.pools) {
      pool?.terminate();
      unregisterAtollPool(name);
    }
  }
}

/**
 * Boots once the app's providers exist: warns when an @AtollTask targets a
 * pool name nothing registered — without a registered pool the decorated
 * method silently falls back to local execution, which is almost never the
 * intent. Skipped inside workers (no pools live there).
 */
@Injectable()
class AtollPoolValidator implements OnModuleInit {
  // Explicit @Inject — esbuild/vitest does not emit design:paramtypes.
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}
  onModuleInit() {
    if (!isMainThread) return;
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance);
      for (const key of Object.getOwnPropertyNames(proto)) {
        const meta = getAtollTaskMeta(proto, key);
        if (meta && !getAtollPool(meta.pool)) {
          moduleLog.warn(
            `@AtollTask ${proto.constructor.name}.${String(key)} targets unregistered pool ` +
              `"${meta.pool}" — calls will execute locally`,
          );
        }
      }
    }
  }
}

// Pool providers only spawn on the main thread — a feature module carrying
// registerPool can be bootstrapped inside a worker via runAtollWorker without
// creating a nested pool; the provider resolves to null there.
const poolProvider = (cfg: NamedPoolConfig): Provider => ({
  provide: getAtollPoolToken(cfg.name),
  useFactory: () => {
    if (!isMainThread) return null;
    const pool = buildAtollPool(cfg);
    registerAtollPool(cfg.name, pool);
    return pool;
  },
});

const lifecycleProvider = (pools: Array<{ name: string }>): Provider => ({
  provide: `ATOLL_POOL_LIFECYCLE:${pools.map((p) => p.name).join('+')}`,
  useFactory: (...poolInstances: Array<WorkerPool | null>) =>
    new AtollPoolLifecycle(poolInstances.map((pool, i) => ({ name: pools[i].name, pool }))),
  inject: pools.map((cfg) => getAtollPoolToken(cfg.name)),
});

export interface AtollModuleAsyncOptions {
  imports?: Array<Type<unknown> | DynamicModule>;
  useFactory: (...args: any[]) => AtollModuleOptions | Promise<AtollModuleOptions>;
  inject?: any[];
}

export interface AtollPoolAsyncOptions {
  /** Registry name — static so the ATOLL_POOL:<name> token stays declarable. */
  name?: string;
  imports?: Array<Type<unknown> | DynamicModule>;
  useFactory: (...args: any[]) => AtollPoolConfig | Promise<AtollPoolConfig>;
  inject?: any[];
}

/**
 * Configures worker pools for the application — Bull/TypeORM-style two-level
 * registration:
 *
 *   // root — global infrastructure once (validator, discovery, lifecycle)
 *   AtollModule.forRoot()                                   // or { pools: [...] }
 *
 *   // feature module — owns its worker domain
 *   @Module({ imports: [AtollModule.registerPool({
 *     name: 'incidents',
 *     worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
 *     sharedMemory: incidentsMemory,
 *   })] })
 *
 * Each pool becomes an injectable provider under `ATOLL_POOL:<name>`
 * (@InjectAtollPool), registers in the AtollPoolRegistry that @AtollTask
 * dispatches through, and terminates on module destroy.
 */
@Module({})
export class AtollModule {
  static forRoot(options: AtollModuleOptions = {}): DynamicModule {
    const pools = (options.pools ?? []).map((cfg, i) => ({
      ...cfg,
      name: cfg.name ?? (i === 0 ? 'default' : `pool${i}`),
    }));

    return {
      global: true,
      module: AtollModule,
      imports: [DiscoveryModule],
      providers: [
        AtollPoolValidator,
        ...pools.map(poolProvider),
        ...(pools.length ? [lifecycleProvider(pools)] : []),
      ],
      exports: pools.map((cfg) => getAtollPoolToken(cfg.name)),
    };
  }

  /**
   * Async root config — same as forRoot but options come from injected deps
   * (e.g. ConfigService). Async pools are reachable through the AtollPoolRegistry
   * (getAtollPool(name) / @AtollTask dispatch) rather than @InjectAtollPool, since
   * their names aren't known until the factory resolves.
   */
  static forRootAsync(options: AtollModuleAsyncOptions): DynamicModule {
    return {
      global: true,
      module: AtollModule,
      imports: [DiscoveryModule, ...(options.imports ?? [])],
      providers: [
        AtollPoolValidator,
        { provide: ATOLL_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        {
          provide: 'ATOLL_POOLS',
          useFactory: (opts: AtollModuleOptions) => {
            if (!isMainThread) return new AtollPoolLifecycle([]);
            const created = (opts.pools ?? []).map((cfg, i) => {
              const name = cfg.name ?? (i === 0 ? 'default' : `pool${i}`);
              const pool = buildAtollPool({ ...cfg, name });
              registerAtollPool(name, pool);
              return { name, pool };
            });
            return new AtollPoolLifecycle(created);
          },
          inject: [ATOLL_OPTIONS],
        },
      ],
    };
  }

  /**
   * Registers one worker pool inside whichever module imports it — the
   * BullModule.registerQueue analog: pool config lives in the feature module
   * that owns the worker instead of accumulating at the root. Export
   * `AtollModule` from that module to re-expose the pool's injection token.
   */
  static registerPool(config: AtollPoolConfig): DynamicModule {
    const named: NamedPoolConfig = { ...config, name: config.name ?? 'default' };
    return {
      module: AtollModule,
      providers: [poolProvider(named), lifecycleProvider([named])],
      exports: [getAtollPoolToken(named.name)],
    };
  }

  /**
   * Async pool registration — the name is static so `ATOLL_POOL:<name>` stays
   * injectable, while the rest of the config resolves from injected deps:
   *
   *   AtollModule.registerPoolAsync({
   *     name: 'incidents',
   *     useFactory: (config: ConfigService) => ({
   *       worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
   *       sharedMemory: incidentsMemory,
   *       poolSize: config.get('INCIDENT_POOL_SIZE'),
   *     }),
   *     inject: [ConfigService],
   *   })
   */
  static registerPoolAsync(options: AtollPoolAsyncOptions): DynamicModule {
    const name = options.name ?? 'default';
    const optionsToken = `${ATOLL_OPTIONS}:${name}`;
    return {
      module: AtollModule,
      imports: options.imports ?? [],
      providers: [
        { provide: optionsToken, useFactory: options.useFactory, inject: options.inject ?? [] },
        {
          provide: getAtollPoolToken(name),
          useFactory: (resolved: AtollPoolConfig) => {
            const pool = buildAtollPool({ ...resolved, name });
            registerAtollPool(name, pool);
            return pool;
          },
          inject: [optionsToken],
        },
        lifecycleProvider([{ name }]),
      ],
      exports: [getAtollPoolToken(name)],
    };
  }
}
