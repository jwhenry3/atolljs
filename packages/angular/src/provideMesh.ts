import {
  DestroyRef,
  ENVIRONMENT_INITIALIZER,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import {
  WorkerPool,
  type SharedAccess,
  type SharedMemory,
  type SharedSpec,
  type TaskMap,
  type WorkerPoolConfig,
} from '@jwhenry123/mesh/sdk';

/**
 * One pool's declaration inside provideMesh — two forms:
 *
 *   // inline: the worker factory keeps the bundler-detectable literal so the
 *   // TS source is the reference
 *   { worker: () => new Worker(new URL('./x.worker.ts', import.meta.url)), sharedMemory, tasks }
 *
 *   // existing: a domain package's already-configured pool factory — the
 *   // same instance task helpers resolve, registered for DI + lifecycle
 *   { pool: getIncidentsPool }
 */
export type MeshPoolDeclaration<
  S extends SharedSpec = SharedSpec,
  T extends TaskMap = TaskMap,
> = { name?: string } & (
  | (Omit<WorkerPoolConfig<S, T>, 'workerUrl' | 'createWorker' | 'sharedMemory'> & {
      /** Spawns one pool worker — usually `() => new Worker(new URL('./x.worker.ts', import.meta.url))`. */
      worker: () => Worker;
      /**
       * The contract this pool shares with its workers. Typed as SharedMemory<S>
       * (not the config field's intersection) so declarations for heterogeneous
       * specs coexist — access fields through the contract const, not the pool.
       */
      sharedMemory: SharedMemory<S>;
    })
  | {
      /**
       * An already-configured pool — e.g. a domain package's singleton the
       * task helpers dispatch through. Registered for DI + lifecycle; the
       * same instance is what injectMeshPool returns.
       */
      // WorkerPool<S,T> is invariant on S through SharedAccess, so the
      // existing-pool form accepts any specialization.
      pool: () => WorkerPool<any, any>;
    }
);

/**
 * Composable feature for provideMesh — the withX pattern. Reserved for
 * cross-cutting additions (logging, timeouts); carries extra providers.
 */
export interface MeshFeature {
  kind: string;
  providers: Provider[];
}

const poolTokens = new Map<string, InjectionToken<WorkerPool>>();

/** InjectionToken for the pool registered under `name` — MESH_POOL:<name>. */
export function getMeshPoolToken(name = 'default'): InjectionToken<WorkerPool> {
  let token = poolTokens.get(name);
  if (!token) poolTokens.set(name, (token = new InjectionToken<WorkerPool>(`MESH_POOL:${name}`)));
  return token;
}

/**
 * Injects the WorkerPool registered under `name` by provideMesh — call in an
 * injection context (field initializer / constructor / factory). Pass the
 * domain pool type to keep its task methods typed; override the provider in
 * TestBed to stub the pool.
 */
export function injectMeshPool<T extends WorkerPool<any, any> = WorkerPool>(name = 'default'): T {
  return inject(getMeshPoolToken(name)) as unknown as T;
}

/**
 * Registers mesh worker pools as Angular providers — the provideHttpClient
 * analog:
 *
 *   bootstrapApplication(AppComponent, {
 *     providers: [
 *       provideMesh({ pools: [{
 *         name: 'incidents',
 *         worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
 *         sharedMemory: incidentsMemory,
 *         tasks: incidentsService.tasks,
 *         poolSize: 'auto',
 *       }] }),
 *     ],
 *   });
 *
 *   // anywhere DI runs:
 *   private readonly pool = injectMeshPool<IncidentsPool>('incidents');
 *
 * Pools spawn eagerly and terminate when the environment injector is
 * destroyed (app teardown / HMR). Also usable at route level via
 * `Route.providers` for lazily-scoped pools.
 */
export function provideMesh(
  options: { pools?: MeshPoolDeclaration[] },
  ...features: MeshFeature[]
): EnvironmentProviders {
  const pools = (options.pools ?? []).map((cfg, i) => ({
    ...cfg,
    name: cfg.name ?? (i === 0 ? 'default' : `pool${i}`),
  }));

  return makeEnvironmentProviders([
    ...pools.map(
      (cfg): Provider => ({
        provide: getMeshPoolToken(cfg.name),
        useFactory: () => {
          if ('pool' in cfg) return cfg.pool() as unknown as WorkerPool;
          const { name: _name, worker, sharedMemory, ...rest } = cfg;
          return new WorkerPool({
            ...rest,
            sharedMemory: sharedMemory as SharedMemory<SharedSpec> & SharedAccess<SharedSpec>,
            createWorker: worker,
          });
        },
      }),
    ),
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        const destroyRef = inject(DestroyRef);
        for (const cfg of pools) {
          const pool = inject(getMeshPoolToken(cfg.name)); // force eager spawn
          destroyRef.onDestroy(() => pool.terminate());
        }
      },
    },
    ...features.flatMap((f) => f.providers),
  ]);
}
