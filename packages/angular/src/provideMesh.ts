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
 * The lifecycle surface every connectWorker client exposes. Declared
 * structurally rather than as `WorkerClient<any, any>` — instantiating
 * WorkerClient's generics with `any` collapses its method map to an index
 * signature no concrete client satisfies.
 */
type AnyWorkerClient = {
  start(): void;
  terminate(): void;
  readonly pool: WorkerPool<any, any> | null;
  readonly sharedMemory: unknown;
};

/**
 * One pool's shape minus its registry name — also the return type of the
 * async pool factories MeshModule.forRootAsync/registerPoolAsync accept.
 * Three forms:
 *
 *   // inline: the worker factory keeps the bundler-detectable literal so the
 *   // TS source is the reference
 *   { worker: () => new Worker(new URL('./x.worker.ts', import.meta.url)), sharedMemory, tasks }
 *
 *   // existing: a domain package's already-configured pool factory — the
 *   // same instance task helpers resolve, registered for DI + lifecycle
 *   { pool: getIncidentsPool }
 *
 *   // typed client: a domain package's connectWorker client — registered
 *   // for DI + lifecycle (terminate() on destroy; it re-spawns lazily)
 *   { client: incidents }
 */
export type MeshPoolSpec<
  S extends SharedSpec = SharedSpec,
  T extends TaskMap = TaskMap,
> =
  | (Omit<WorkerPoolConfig<S, T>, 'workerUrl' | 'createWorker' | 'sharedMemory'> & {
      /** Spawns one pool worker — usually `() => new Worker(new URL('./x.worker.ts', import.meta.url))`. */
      worker: () => Worker;
      /**
       * The contract this pool shares with its workers. Typed as SharedMemory<S>
       * (not the config field's intersection) so declarations for heterogeneous
       * specs coexist — access fields through the contract const, not the pool.
       * Omit for message-only pools.
       */
      sharedMemory?: SharedMemory<S>;
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
  | {
      /**
       * An already-built connectWorker client — the provider value is the
       * client itself, so injectMeshPool returns the typed call surface.
       * Terminated on injector destroy; the lazy client re-spawns on the
       * next call.
       */
      client: AnyWorkerClient;
    };

/**
 * One pool's declaration inside provideMesh — a named MeshPoolSpec. The name
 * selects the injection token (`MESH_POOL:<name>`); the first pool defaults
 * to "default".
 */
export type MeshPoolDeclaration<
  S extends SharedSpec = SharedSpec,
  T extends TaskMap = TaskMap,
> = { name?: string } & MeshPoolSpec<S, T>;

/** provideMesh / MeshModule.forRoot options. */
export interface MeshProvideOptions {
  pools?: MeshPoolDeclaration[];
}

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
export function injectMeshPool<T = WorkerPool>(name = 'default'): T {
  return inject(getMeshPoolToken(name)) as unknown as T;
}

type NamedPoolDeclaration = MeshPoolDeclaration & { name: string };

const defaultName = (cfg: MeshPoolDeclaration, i: number) =>
  cfg.name ?? (i === 0 ? 'default' : `pool${i}`);

/** @internal Instantiate whatever a declaration describes — client / existing pool / inline config. */
export function buildMeshPool(cfg: NamedPoolDeclaration): WorkerPool {
  if ('client' in cfg) return cfg.client as unknown as WorkerPool;
  if ('pool' in cfg) return cfg.pool() as unknown as WorkerPool;
  const { name: _name, worker, sharedMemory, ...rest } = cfg;
  return new WorkerPool({
    ...rest,
    ...(sharedMemory
      ? { sharedMemory: sharedMemory as SharedMemory<SharedSpec> & SharedAccess<SharedSpec> }
      : {}),
    createWorker: worker,
  });
}

/**
 * @internal The provider list both provideMesh and MeshModule's statics are
 * built from — keeps the declaration-union handling in one place. Appends an
 * ENVIRONMENT_INITIALIZER that eagerly spawns each pool and terminates it
 * when the owning injector is destroyed (app teardown / HMR).
 */
export function meshProviders(
  pools: MeshPoolDeclaration[],
  features: MeshFeature[] = [],
): Provider[] {
  const named = pools.map((cfg, i) => ({ ...cfg, name: defaultName(cfg, i) }));
  return [
    ...named.map(
      (cfg): Provider => ({
        provide: getMeshPoolToken(cfg.name),
        useFactory: () => buildMeshPool(cfg),
      }),
    ),
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        const destroyRef = inject(DestroyRef);
        for (const cfg of named) {
          const pool = inject(getMeshPoolToken(cfg.name)); // force eager spawn
          destroyRef.onDestroy(() => pool.terminate());
        }
      },
    },
    ...features.flatMap((f) => f.providers),
  ];
}

/**
 * Registers mesh worker pools as Angular providers — the provideHttpClient
 * analog:
 *
 *   bootstrapApplication(AppComponent, {
 *     providers: [
 *       provideMesh({ pools: [{ name: 'incidents', client: incidents }] }),
 *     ],
 *   });
 *
 *   // anywhere DI runs:
 *   private readonly incidents = injectMeshPool<IncidentsClient>('incidents');
 *
 * Pools spawn eagerly and terminate when the environment injector is
 * destroyed (app teardown / HMR). Also usable at route level via
 * `Route.providers` for lazily-scoped pools.
 */
export function provideMesh(
  options: MeshProvideOptions,
  ...features: MeshFeature[]
): EnvironmentProviders {
  return makeEnvironmentProviders(meshProviders(options.pools ?? [], features));
}
