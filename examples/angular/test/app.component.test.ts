// @vitest-environment happy-dom
/**
 * Functional test: the angular example's AppComponent driving the real mesh
 * in-process. Instantiated inside TestBed's injection context so the signal
 * bindings, DestroyRef cleanup, and the component's effect() get real DI.
 */
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { provideMesh } from '@jwhenry123/mesh-angular';
import { getIncidentsPool } from '@jwhenry123/mesh-incidents';
import { InProcessWorker } from '../../../test/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('@jwhenry123/mesh/incidents/worker/incidents.worker'),
];

let AppComponent: typeof import('../src/app.component').AppComponent;
beforeAll(async () => {
  ({ AppComponent } = await import('../src/app.component'));
});

describe('AppComponent (angular example)', () => {
  it('seeds, reports progress, and serves table pages', async () => {
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
    // Mirror main.ts: the domain-owned pool singleton under DI.
    TestBed.configureTestingModule({
      providers: [provideMesh({ pools: [{ name: 'incidents', pool: getIncidentsPool }] })],
    });
    const comp = TestBed.runInInjectionContext(() => new AppComponent());
    const c = comp as unknown as {
      ready(): boolean; seedProgress(): number;
      page(): { rows: unknown[] } | null; metrics(): { critical: number } | null;
      rows(): unknown[]; filtered(): number;
    };
    await vi.waitFor(() => expect(c.ready()).toBe(true), { timeout: 20_000 });
    await vi.waitFor(() => expect(c.seedProgress()).toBe(100));
    await vi.waitFor(() => {
      expect(c.rows()).toHaveLength(50); // default pageSize
      expect(c.metrics()?.critical).toBeGreaterThan(0);
    });
    TestBed.resetTestingModule();
  });
});
