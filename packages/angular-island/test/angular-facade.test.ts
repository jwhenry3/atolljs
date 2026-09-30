// @vitest-environment happy-dom
/**
 * The Angular facade — `@AngularIsland` (worker-side decorator) and
 * `islandComponent` (shell-side generated component). In-process E2E like
 * the island tests: real registry + op protocol, the only fake being the
 * thread boundary (InProcessWorker runs the real worker entry in the
 * test's module graph).
 *
 * What's under test:
 *  - @AngularIsland stamps + registers: defineAngularPolyWorker() with no
 *    args collects the decorated components; the apps array form names
 *    undecorated components by kebab-cased class name.
 *  - Root-component output()/model() fields bridge to island emit events.
 *  - `islandComponent` returns a real standalone component (hand-authored
 *    ɵcmp — TestBed mounts it without any template compilation of our own).
 *  - `[app]` accepts the component CLASS (stamp-resolved name) and the
 *    `worker` shorthand spares the manual connectIslandWorker ceremony.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import type { IslandHandle } from '@atolljs/islands';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { AtollIslandComponent, islandComponent } from '../src/index';
import { angularIslandNameOf } from '../src/worker';
import type { GreetComponent, SaverComponent } from './fixtures/facade.worker';
import * as facadeFixture from './fixtures/facade.worker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/facade.worker')];

const renderWorker = () =>
  new Worker(new URL('./fixtures/facade.worker.ts', import.meta.url), { type: 'module' });

// The facade components are generated ONCE — importing the component class
// for `[app]` is a test-env convenience (in-process module graph); real
// shells use `import type` + the registry name.
const GreetIsland = islandComponent<GreetComponent>({
  app: facadeFixture.GreetComponent,
  selector: 'greet-island',
});
const SaverIsland = islandComponent<SaverComponent>({
  app: 'saver-app',
  selector: 'saver-island',
});
// Fully baked — the worker ships with the facade, so the template call site
// is just `<baked-greet-island [props]="…"/>`.
const BakedGreetIsland = islandComponent<GreetComponent>({
  app: 'greet',
  worker: renderWorker,
  selector: 'baked-greet-island',
});

let realDoc: Document;
beforeAll(() => {
  realDoc = document;
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('@AngularIsland + defineAngularPolyWorker', () => {
  it('derives registry names — explicit, kebab-cased, and stamped', () => {
    expect(angularIslandNameOf(facadeFixture.GreetComponent)).toBe('greet');
    expect(angularIslandNameOf(facadeFixture.SaverComponent)).toBe('saver-app');
    expect(angularIslandNameOf(facadeFixture.VoterComponent)).toBe('voter');
    // The array form (no decorator) names by the same kebab convention.
    expect(angularIslandNameOf(facadeFixture.PlainEchoComponent)).toBe('plain-echo');
  });

  it('no-arg defineAngularPolyWorker collects decorated components', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    // 'greet' and 'voter' were registered by the DECORATOR — no apps map
    // anywhere names them; the no-arg registry is the only path.
    const island = await import('@atolljs/islands').then(({ mountIsland }) =>
      mountIsland({
        worker: renderWorker,
        el,
        app: 'greet',
        props: { label: 'registry-greet' },
      }),
    );
    await vi.waitFor(() =>
      expect(el.querySelector('.greet')?.textContent).toBe('registry-greet'),
    );
    island.destroy();
  });

  it('array-form apps register undecorated components under kebab names', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const { mountIsland } = await import('@atolljs/islands');
    const island = await mountIsland({
      worker: renderWorker,
      el,
      app: 'plain-echo',
      props: { text: 'from the array' },
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.plain')?.textContent).toBe('from the array'),
    );
    island.destroy();
  });
});

describe('output → emit bridging', () => {
  it('a root output() field emits an island event under its name', async () => {
    const emitted: Array<{ name: string; payload: unknown }> = [];
    const fixture = TestBed.createComponent(SaverIsland);
    fixture.componentRef.setInput('worker', renderWorker);
    fixture.componentRef.setInput('props', { amount: 42 });
    fixture.componentRef.setInput('onEvent', (name: string, payload: unknown) => {
      emitted.push({ name, payload });
    });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => expect(host.querySelector('.save-btn')).not.toBeNull());
    host.querySelector('.save-btn')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    // The click ran `save.emit(42)` component-side — the adapter bridges
    // the declared output onto the island's emit channel.
    await vi.waitFor(() =>
      expect(emitted.some((e) => e.name === 'save' && e.payload === 42)).toBe(true),
    );
  });

  it('a model() field emits <name>Change like Angular two-way binding', async () => {
    const emitted: Array<{ name: string; payload: unknown }> = [];
    const fixture = TestBed.createComponent(AtollIslandComponent);
    fixture.componentRef.setInput('worker', renderWorker);
    fixture.componentRef.setInput('app', 'voter');
    fixture.componentRef.setInput('onEvent', (name: string, payload: unknown) => {
      emitted.push({ name, payload });
    });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => expect(host.querySelector('.vote-btn')).not.toBeNull());
    host.querySelector('.vote-btn')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await vi.waitFor(() =>
      expect(emitted.some((e) => e.name === 'voteChange' && e.payload === 1)).toBe(true),
    );
    // And the re-render rode the same dispatch batch.
    await vi.waitFor(() =>
      expect(host.querySelector('.vote-btn')?.textContent).toContain('1'),
    );
  });
});

describe('islandComponent facade', () => {
  it('mounts with baked-in app + worker shorthand — no connectIslandWorker', async () => {
    let handle: IslandHandle | undefined;
    const fixture = TestBed.createComponent(GreetIsland);
    fixture.componentRef.setInput('worker', renderWorker);
    fixture.componentRef.setInput('props', { label: 'facade props' });
    fixture.componentRef.setInput('onReady', (h: IslandHandle) => {
      handle = h;
    });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() =>
      expect(host.querySelector('.greet')?.textContent).toBe('facade props'),
    );
    expect(handle?.pid).toMatch(/^w-/);
    expect(handle?.app).toBe('greet');

    // Props update flows through the inherited input surface.
    fixture.componentRef.setInput('props', { label: 'updated facade' });
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(host.querySelector('.greet')?.textContent).toBe('updated facade'),
    );

    // Destroy cleans up the island-owned worker.
    fixture.destroy();
    expect(handle).toBeDefined();
  });

  it('[app] accepts the component class — the stamp resolves the name', async () => {
    const fixture = TestBed.createComponent(AtollIslandComponent);
    fixture.componentRef.setInput('worker', renderWorker);
    fixture.componentRef.setInput('app', facadeFixture.GreetComponent);
    fixture.componentRef.setInput('props', { label: 'by class ref' });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() =>
      expect(host.querySelector('.greet')?.textContent).toBe('by class ref'),
    );
  });

  it('is a real standalone component — imported + bound from a template', async () => {
    @Component({
      standalone: true,
      imports: [BakedGreetIsland],
      // Zero island ceremony at the call site — worker + app are baked in.
      template: `<baked-greet-island [props]="{ label: 'template host' }" />`,
    })
    class HostComponent {}

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() =>
      expect(host.querySelector('.greet')?.textContent).toBe('template host'),
    );
  });
});
