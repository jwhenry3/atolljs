// @vitest-environment happy-dom
/**
 * MeshModule — the NgModule form of provideMesh. TestBed-free coverage via
 * createEnvironmentInjector (same style as bindings.test.ts) plus real
 * TestBed NgModule tests for forRoot / registerPool / the async forms and
 * the @InjectMeshPool parameter decorator.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ApplicationInitStatus,
  createEnvironmentInjector,
  importProvidersFrom,
  Injectable,
  InjectionToken,
  NgModule,
  runInInjectionContext,
  type EnvironmentInjector,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { getMeshPoolToken, injectMeshPool, InjectMeshPool, MeshModule } from '../src/index';

// Angular's type requires an EnvironmentInjector parent; runtime accepts null.
const ROOT_PARENT = null as unknown as EnvironmentInjector;
const rootEnv = (): EnvironmentInjector => createEnvironmentInjector([], ROOT_PARENT);

/** Structurally satisfies the connectWorker client shape — terminate() is the lifecycle assertion. */
const fakeClient = () => ({
  start: vi.fn(),
  terminate: vi.fn(),
  pool: null,
  sharedMemory: undefined,
});

describe('MeshModule (environment injector)', () => {
  it('forRoot registers the client pool and terminates on injector destroy', () => {
    const client = fakeClient();
    const injector = createEnvironmentInjector(
      [importProvidersFrom(MeshModule.forRoot({ pools: [{ name: 'root', client }] }))],
      rootEnv(),
    );
    try {
      expect(runInInjectionContext(injector, () => injectMeshPool('root'))).toBe(client);
    } finally {
      injector.destroy();
    }
    expect(client.terminate).toHaveBeenCalled();
  });

  it('registerPool registers one pool in the importing scope', () => {
    const client = fakeClient();
    const injector = createEnvironmentInjector(
      [importProvidersFrom(MeshModule.registerPool({ name: 'feature', client }))],
      rootEnv(),
    );
    try {
      expect(runInInjectionContext(injector, () => injectMeshPool('feature'))).toBe(client);
    } finally {
      injector.destroy();
    }
    expect(client.terminate).toHaveBeenCalled();
  });

  it('forRootAsync resolves the declaration through injected deps via ApplicationInitStatus', async () => {
    const client = fakeClient();
    const POOL_CONFIG = new InjectionToken<{ client: typeof client }>('POOL_CONFIG');
    const injector = createEnvironmentInjector(
      [
        { provide: POOL_CONFIG, useValue: { client } },
        // Provided by bootstrapApplication / TestBed — a bare env injector
        // has to list it explicitly to run app initializers.
        ApplicationInitStatus,
        importProvidersFrom(
          MeshModule.forRootAsync({
            pools: [
              {
                name: 'async-root',
                inject: [POOL_CONFIG],
                useFactory: (cfg: { client: typeof client }) =>
                  Promise.resolve({ client: cfg.client }),
              },
            ],
          }),
        ),
      ],
      rootEnv(),
    );
    try {
      // Bare environment injectors don't bootstrap — run the app initializers
      // the way bootstrapApplication / TestBed do (runInitializers is
      // internal API, hence the cast).
      const status = injector.get(ApplicationInitStatus) as ApplicationInitStatus & {
        runInitializers(): void;
      };
      status.runInitializers();
      await status.donePromise;
      expect(injector.get(getMeshPoolToken('async-root'))).toBe(client);
    } finally {
      injector.destroy();
    }
    expect(client.terminate).toHaveBeenCalled();
  });
});

describe('MeshModule (TestBed)', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });

  it('forRoot + registerPool pools are injectable and terminate on resetTestingModule', () => {
    const rootClient = fakeClient();
    const featureClient = fakeClient();

    @NgModule({
      imports: [MeshModule.registerPool({ name: 'feature', client: featureClient })],
    })
    class FeatureModule {}

    @NgModule({
      imports: [
        MeshModule.forRoot({ pools: [{ name: 'root', client: rootClient }] }),
        FeatureModule,
      ],
    })
    class AppModule {}

    TestBed.configureTestingModule({ imports: [AppModule] });
    try {
      expect(TestBed.inject(getMeshPoolToken('root'))).toBe(rootClient);
      expect(TestBed.inject(getMeshPoolToken('feature'))).toBe(featureClient);
    } finally {
      TestBed.resetTestingModule();
    }
    expect(rootClient.terminate).toHaveBeenCalled();
    expect(featureClient.terminate).toHaveBeenCalled();
  });

  it('@InjectMeshPool resolves a pool on an @Injectable constructor param', () => {
    const client = fakeClient();

    @Injectable()
    class Consumer {
      constructor(@InjectMeshPool('svc') public readonly pool: unknown) {}
    }

    @NgModule({
      imports: [MeshModule.forRoot({ pools: [{ name: 'svc', client }] })],
      providers: [Consumer],
    })
    class AppModule {}

    TestBed.configureTestingModule({ imports: [AppModule] });
    try {
      expect(TestBed.inject(Consumer).pool).toBe(client);
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('registerPoolAsync awaits useFactory during app init, then injects and terminates', async () => {
    const client = fakeClient();
    const POOL_CONFIG = new InjectionToken<{ client: typeof client }>('POOL_CONFIG');
    const useFactory = vi.fn((cfg: { client: typeof client }) =>
      Promise.resolve({ client: cfg.client }),
    );

    @NgModule({
      imports: [
        MeshModule.registerPoolAsync({
          name: 'async',
          inject: [POOL_CONFIG],
          useFactory,
        }),
      ],
      providers: [{ provide: POOL_CONFIG, useValue: { client } }],
    })
    class FeatureModule {}

    TestBed.configureTestingModule({ imports: [FeatureModule] });
    try {
      // TestBed runs APP_INITIALIZERs when the module injector is created.
      const status = TestBed.inject(ApplicationInitStatus);
      await status.donePromise;
      expect(useFactory).toHaveBeenCalledWith({ client });
      expect(TestBed.inject(getMeshPoolToken('async'))).toBe(client);
    } finally {
      TestBed.resetTestingModule();
    }
    expect(client.terminate).toHaveBeenCalled();
  });

  it('forRootAsync pools resolve during app init', async () => {
    const client = fakeClient();
    const POOL_CONFIG = new InjectionToken<{ client: typeof client }>('POOL_CONFIG');

    @NgModule({
      imports: [
        MeshModule.forRootAsync({
          pools: [
            {
              name: 'async-root',
              inject: [POOL_CONFIG],
              useFactory: (cfg: { client: typeof client }) => ({ client: cfg.client }),
            },
          ],
        }),
      ],
      providers: [{ provide: POOL_CONFIG, useValue: { client } }],
    })
    class AppModule {}

    TestBed.configureTestingModule({ imports: [AppModule] });
    try {
      const status = TestBed.inject(ApplicationInitStatus);
      await status.donePromise;
      expect(TestBed.inject(getMeshPoolToken('async-root'))).toBe(client);
    } finally {
      TestBed.resetTestingModule();
    }
    expect(client.terminate).toHaveBeenCalled();
  });
});
