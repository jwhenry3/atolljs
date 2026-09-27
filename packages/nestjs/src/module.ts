import {
  DynamicModule,
  Module,
  OnModuleDestroy,
  Provider,
} from '@nestjs/common';
import type { WorkerPool } from '@jwhenry123/mesh/sdk';
import {
  buildMeshPool,
  getMeshPoolToken,
  registerMeshPool,
  unregisterMeshPool,
  type MeshModuleOptions,
} from './pools';

const MESH_POOL_LIFECYCLE = 'MESH_POOL_LIFECYCLE';

class MeshPoolLifecycle implements OnModuleDestroy {
  constructor(private readonly pools: Array<{ name: string; pool: WorkerPool }>) {}
  onModuleDestroy() {
    for (const { name, pool } of this.pools) {
      pool.terminate();
      unregisterMeshPool(name);
    }
  }
}

/**
 * Configures worker pools for the application:
 *
 *   MeshModule.forRoot({
 *     pools: [{
 *       name: 'incidents',
 *       workerFile: join(distDir, 'incidents.worker.js'),
 *       sharedMemory: incidentsMemory,
 *       poolSize: 'auto',
 *       tasks: incidentsTasks,          // optional first-class task methods
 *     }],
 *   })
 *
 * Each pool becomes an injectable provider under `MESH_POOL:<name>`
 * (@InjectMeshPool), registers in the MeshPoolRegistry that @MeshTask
 * dispatches through, and terminates on module destroy.
 */
@Module({})
export class MeshModule {
  static forRoot(options: MeshModuleOptions): DynamicModule {
    const pools = options.pools.map((cfg, i) => ({
      ...cfg,
      name: cfg.name ?? (i === 0 ? 'default' : `pool${i}`),
    }));

    const poolProviders: Provider[] = pools.map((cfg) => ({
      provide: getMeshPoolToken(cfg.name),
      useFactory: () => {
        const pool = buildMeshPool(cfg);
        registerMeshPool(cfg.name, pool);
        return pool;
      },
    }));

    const lifecycleProvider: Provider = {
      provide: MESH_POOL_LIFECYCLE,
      useFactory: (...poolInstances: WorkerPool[]) =>
        new MeshPoolLifecycle(
          poolInstances.map((pool, i) => ({ name: pools[i].name, pool })),
        ),
      inject: pools.map((cfg) => getMeshPoolToken(cfg.name)),
    };

    return {
      module: MeshModule,
      providers: [...poolProviders, lifecycleProvider],
      exports: pools.map((cfg) => getMeshPoolToken(cfg.name)),
    };
  }
}
