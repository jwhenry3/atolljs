import {
  APP_INITIALIZER,
  DestroyRef,
  Inject,
  InjectionToken,
  Injector,
  NgModule,
  type ModuleWithProviders,
  type Provider,
  type Type,
} from '@angular/core';
import {
  buildMeshPool,
  getMeshPoolToken,
  meshProviders,
  type MeshFeature,
  type MeshPoolDeclaration,
  type MeshPoolSpec,
  type MeshProvideOptions,
} from './provideMesh';

/**
 * A pool whose declaration resolves from injected deps during app init — the
 * async form of MeshPoolDeclaration. The name stays static so the
 * `MESH_POOL:<name>` injection token can be declared up front.
 */
export interface MeshPoolAsyncDecl {
  /** Registry name — declares the MESH_POOL:<name> token before the factory resolves. */
  name?: string;
  /** Provider tokens passed to useFactory, in order. */
  inject?: unknown[];
  /**
   * Receives the injected deps; returns a MeshPoolDeclaration or a Promise
   * of one. A `name` on the result is ignored — the static `name` field owns
   * the registry slot.
   */
  useFactory: (...args: any[]) => MeshPoolDeclaration | Promise<MeshPoolDeclaration>;
}

/** MeshModule.forRootAsync options. */
export interface MeshModuleAsyncOptions {
  pools?: MeshPoolAsyncDecl[];
}

/** MeshModule.registerPoolAsync options — BullModule.registerQueueAsync analog. */
export interface MeshPoolAsyncOptions {
  /** Registry name — static so `MESH_POOL:<name>` stays injectable while the factory resolves. */
  name?: string;
  /**
   * Kept for Nest-parity/documentation: Angular's ModuleWithProviders has no
   * `imports` slot, so this only documents where `inject` deps come from —
   * they resolve through whichever injector imports the module (NgModule
   * providers flatten into the importing injector). List dep-providing
   * modules on the consuming @NgModule's `imports`.
   */
  imports?: Array<Type<unknown> | ModuleWithProviders<unknown> | unknown[]>;
  /** Provider tokens passed to useFactory, in order. */
  inject?: unknown[];
  /** Receives the injected deps; returns a MeshPoolSpec (no `name` — the static field owns it) or a Promise of one. */
  useFactory: (...args: any[]) => MeshPoolSpec | Promise<MeshPoolSpec>;
}

/**
 * Mutable slot an async initializer fills before bootstrap completes — the
 * pool factory reads it lazily, after APP_INITIALIZER has resolved.
 */
interface AsyncDeclHolder {
  decl?: MeshPoolDeclaration;
}

/**
 * Two-stage async pool. Angular provider factories can't await, so an
 * APP_INITIALIZER (multi:true) resolves useFactory into the holder during
 * bootstrap — `inject` deps arrive through that record's factory signature.
 * The initializer then forces the spawn itself and hooks terminate() on the
 * injector's DestroyRef, because the sync path's ENVIRONMENT_INITIALIZER runs
 * at injector creation — too early to await anything.
 */
function asyncPoolProviders(
  name: string,
  options: { inject?: unknown[]; useFactory: (...args: any[]) => unknown },
): Provider[] {
  const declHolder = new InjectionToken<AsyncDeclHolder>(`MESH_POOL_DECL:${name}`);
  return [
    { provide: declHolder, useValue: {} satisfies AsyncDeclHolder },
    {
      provide: getMeshPoolToken(name),
      useFactory: (holder: AsyncDeclHolder) => {
        if (!holder.decl) {
          throw new Error(
            `Mesh pool "${name}" injected before its async declaration resolved — ` +
              'bootstrap blocks on APP_INITIALIZER; under TestBed await ' +
              'ApplicationInitStatus.donePromise first.',
          );
        }
        return buildMeshPool({ ...holder.decl, name });
      },
      deps: [declHolder],
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: (holder: AsyncDeclHolder, injector: Injector, ...deps: unknown[]) => {
        const destroyRef = injector.get(DestroyRef);
        return async () => {
          const resolved = (await options.useFactory(...deps)) as MeshPoolDeclaration;
          holder.decl = { ...resolved, name };
          const pool = injector.get(getMeshPoolToken(name)); // eager spawn once resolved
          destroyRef.onDestroy(() => pool.terminate());
        };
      },
      deps: [declHolder, Injector, ...(options.inject ?? [])],
    },
  ];
}

/**
 * NgModule form of provideMesh — the NestJS binding's vocabulary
 * (forRoot / forRootAsync / registerPool / registerPoolAsync) for apps still
 * on NgModule bootstrap:
 *
 *   @NgModule({
 *     imports: [
 *       MeshModule.forRoot(),                  // or forRoot({ pools: [...] })
 *       IncidentsModule,                       // imports MeshModule.registerPool({ name: 'incidents', client: incidents })
 *     ],
 *   })
 *   export class AppModule {}
 *
 * The standalone provider API — `provideMesh` + `injectMeshPool` — remains
 * the primary interface (bootstrapApplication providers, route-level pools);
 * MeshModule exists for codebases that organize DI around NgModules. Both
 * paths register the same `MESH_POOL:<name>` tokens, spawn eagerly, and
 * terminate pools when the owning injector is destroyed.
 */
@NgModule()
export class MeshModule {
  /**
   * Root registration — equivalent providers to `provideMesh(options,
   * ...features)`, imported once by the root module.
   */
  static forRoot(
    options?: MeshProvideOptions,
    ...features: MeshFeature[]
  ): ModuleWithProviders<MeshModule> {
    return { ngModule: MeshModule, providers: meshProviders(options?.pools ?? [], features) };
  }

  /**
   * Async root registration — each pool's declaration resolves through an
   * APP_INITIALIZER before bootstrap completes. The `name` field is static
   * so the `MESH_POOL:<name>` token stays injectable.
   */
  static forRootAsync(options: MeshModuleAsyncOptions): ModuleWithProviders<MeshModule> {
    const providers: Provider[] = (options.pools ?? []).flatMap((decl, i) =>
      asyncPoolProviders(decl.name ?? (i === 0 ? 'default' : `pool${i}`), decl),
    );
    return { ngModule: MeshModule, providers };
  }

  /**
   * Registers one pool inside whichever module imports it — the
   * `provideMesh({ pools: [decl] })` equivalent scoped to the importing
   * NgModule: pool config lives in the feature module that owns the worker.
   */
  static registerPool(decl: MeshPoolDeclaration): ModuleWithProviders<MeshModule> {
    return { ngModule: MeshModule, providers: meshProviders([decl]) };
  }

  /**
   * Async pool registration — the name is static so `MESH_POOL:<name>` stays
   * injectable, while the rest of the spec resolves from injected deps:
   *
   *   MeshModule.registerPoolAsync({
   *     name: 'incidents',
   *     useFactory: (config: PoolConfig) => Promise.resolve({
   *       worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
   *       sharedMemory: incidentsMemory,
   *       poolSize: config.poolSize,
   *     }),
   *     inject: [PoolConfig],
   *   })
   */
  static registerPoolAsync(options: MeshPoolAsyncOptions): ModuleWithProviders<MeshModule> {
    return {
      ngModule: MeshModule,
      providers: asyncPoolProviders(options.name ?? 'default', options),
    };
  }
}

/**
 * Constructor-parameter form of injectMeshPool — injects the pool registered
 * under `name` into an @Injectable() (or component/directive) constructor:
 *
 *   constructor(@InjectMeshPool('incidents') private readonly pool: IncidentsClient) {}
 */
export const InjectMeshPool = (name = 'default'): ParameterDecorator =>
  Inject(getMeshPoolToken(name));
