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
import { scoped, type WorkerPool } from '@jwhenry123/mesh/sdk';
import { getMeshTaskMeta } from './decorators';
import {
  buildMeshPool,
  getMeshPool,
  getMeshPoolToken,
  registerMeshPool,
  unregisterMeshPool,
  type MeshModuleOptions,
  type MeshPoolConfig,
} from './pools';

const MESH_OPTIONS = 'MESH_OPTIONS';
const moduleLog = scoped('mesh-nestjs');

type NamedPoolConfig = MeshPoolConfig & { name: string };

class MeshPoolLifecycle implements OnModuleDestroy {
  constructor(private readonly pools: Array<{ name: string; pool: WorkerPool | null }>) {}
  onModuleDestroy() {
    for (const { name, pool } of this.pools) {
      pool?.terminate();
      unregisterMeshPool(name);
    }
  }
}

/**
 * Boots once the app's providers exist: warns when an @MeshTask targets a
 * pool name nothing registered — without a registered pool the decorated
 * method silently falls back to local execution, which is almost never the
 * intent. Skipped inside workers (no pools live there).
 */
@Injectable()
class MeshPoolValidator implements OnModuleInit {
  // Explicit @Inject — esbuild/vitest does not emit design:paramtypes.
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}
  onModuleInit() {
    if (!isMainThread) return;
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance);
      for (const key of Object.getOwnPropertyNames(proto)) {
        const meta = getMeshTaskMeta(proto, key);
        if (meta && !getMeshPool(meta.pool)) {
          moduleLog.warn(
            `@MeshTask ${proto.constructor.name}.${String(key)} targets unregistered pool ` +
              `"${meta.pool}" — calls will execute locally`,
          );
        }
      }
    }
  }
}

// Pool providers only spawn on the main thread — a feature module carrying
// registerPool can be bootstrapped inside a worker via runMeshWorker without
// creating a nested pool; the provider resolves to null there.
const poolProvider = (cfg: NamedPoolConfig): Provider => ({
  provide: getMeshPoolToken(cfg.name),
  useFactory: () => {
    if (!isMainThread) return null;
    const pool = buildMeshPool(cfg);
    registerMeshPool(cfg.name, pool);
    return pool;
  },
});

const lifecycleProvider = (pools: Array<{ name: string }>): Provider => ({
  provide: `MESH_POOL_LIFECYCLE:${pools.map((p) => p.name).join('+')}`,
  useFactory: (...poolInstances: Array<WorkerPool | null>) =>
    new MeshPoolLifecycle(poolInstances.map((pool, i) => ({ name: pools[i].name, pool }))),
  inject: pools.map((cfg) => getMeshPoolToken(cfg.name)),
});

export interface MeshModuleAsyncOptions {
  imports?: Array<Type<unknown> | DynamicModule>;
  useFactory: (...args: any[]) => MeshModuleOptions | Promise<MeshModuleOptions>;
  inject?: any[];
}

export interface MeshPoolAsyncOptions {
  /** Registry name — static so the MESH_POOL:<name> token stays declarable. */
  name?: string;
  imports?: Array<Type<unknown> | DynamicModule>;
  useFactory: (...args: any[]) => MeshPoolConfig | Promise<MeshPoolConfig>;
  inject?: any[];
}

/**
 * Configures worker pools for the application — Bull/TypeORM-style two-level
 * registration:
 *
 *   // root — global infrastructure once (validator, discovery, lifecycle)
 *   MeshModule.forRoot()                                   // or { pools: [...] }
 *
 *   // feature module — owns its worker domain
 *   @Module({ imports: [MeshModule.registerPool({
 *     name: 'incidents',
 *     worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
 *     sharedMemory: incidentsMemory,
 *     tasks: incidentsService.tasks,
 *   })] })
 *
 * Each pool becomes an injectable provider under `MESH_POOL:<name>`
 * (@InjectMeshPool), registers in the MeshPoolRegistry that @MeshTask
 * dispatches through, and terminates on module destroy.
 */
@Module({})
export class MeshModule {
  static forRoot(options: MeshModuleOptions = {}): DynamicModule {
    const pools = (options.pools ?? []).map((cfg, i) => ({
      ...cfg,
      name: cfg.name ?? (i === 0 ? 'default' : `pool${i}`),
    }));

    return {
      global: true,
      module: MeshModule,
      imports: [DiscoveryModule],
      providers: [
        MeshPoolValidator,
        ...pools.map(poolProvider),
        ...(pools.length ? [lifecycleProvider(pools)] : []),
      ],
      exports: pools.map((cfg) => getMeshPoolToken(cfg.name)),
    };
  }

  /**
   * Async root config — same as forRoot but options come from injected deps
   * (e.g. ConfigService). Async pools are reachable through the MeshPoolRegistry
   * (getMeshPool(name) / @MeshTask dispatch) rather than @InjectMeshPool, since
   * their names aren't known until the factory resolves.
   */
  static forRootAsync(options: MeshModuleAsyncOptions): DynamicModule {
    return {
      global: true,
      module: MeshModule,
      imports: [DiscoveryModule, ...(options.imports ?? [])],
      providers: [
        MeshPoolValidator,
        { provide: MESH_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        {
          provide: 'MESH_POOLS',
          useFactory: (opts: MeshModuleOptions) => {
            if (!isMainThread) return new MeshPoolLifecycle([]);
            const created = (opts.pools ?? []).map((cfg, i) => {
              const name = cfg.name ?? (i === 0 ? 'default' : `pool${i}`);
              const pool = buildMeshPool({ ...cfg, name });
              registerMeshPool(name, pool);
              return { name, pool };
            });
            return new MeshPoolLifecycle(created);
          },
          inject: [MESH_OPTIONS],
        },
      ],
    };
  }

  /**
   * Registers one worker pool inside whichever module imports it — the
   * BullModule.registerQueue analog: pool config lives in the feature module
   * that owns the worker instead of accumulating at the root. Export
   * `MeshModule` from that module to re-expose the pool's injection token.
   */
  static registerPool(config: MeshPoolConfig): DynamicModule {
    const named: NamedPoolConfig = { ...config, name: config.name ?? 'default' };
    return {
      module: MeshModule,
      providers: [poolProvider(named), lifecycleProvider([named])],
      exports: [getMeshPoolToken(named.name)],
    };
  }

  /**
   * Async pool registration — the name is static so `MESH_POOL:<name>` stays
   * injectable, while the rest of the config resolves from injected deps:
   *
   *   MeshModule.registerPoolAsync({
   *     name: 'incidents',
   *     useFactory: (config: ConfigService) => ({
   *       worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
   *       sharedMemory: incidentsMemory,
   *       poolSize: config.get('INCIDENT_POOL_SIZE'),
   *     }),
   *     inject: [ConfigService],
   *   })
   */
  static registerPoolAsync(options: MeshPoolAsyncOptions): DynamicModule {
    const name = options.name ?? 'default';
    const optionsToken = `${MESH_OPTIONS}:${name}`;
    return {
      module: MeshModule,
      imports: options.imports ?? [],
      providers: [
        { provide: optionsToken, useFactory: options.useFactory, inject: options.inject ?? [] },
        {
          provide: getMeshPoolToken(name),
          useFactory: (resolved: MeshPoolConfig) => {
            const pool = buildMeshPool({ ...resolved, name });
            registerMeshPool(name, pool);
            return pool;
          },
          inject: [optionsToken],
        },
        lifecycleProvider([{ name }]),
      ],
      exports: [getMeshPoolToken(name)],
    };
  }
}
