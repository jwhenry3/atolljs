// @vitest-environment happy-dom
/**
 * `<mesh-island>` / `[meshIsland]` — mounts an island worker declaratively
 * from an Angular shell. In-process E2E like the React island test: real
 * registry + op protocol, the only fake being the thread boundary
 * (InProcessWorker runs the real worker entry in the test's module graph).
 *
 * TestBed is the simplest supported approach for rendering a component into
 * real DOM (a bare environment injector has no renderer); the harness runs
 * zoneless — Angular 22's default — so `fixture.detectChanges()` is called
 * explicitly where inputs change.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { connectIslandWorker } from '@jwhenry123/mesh-islands';
import type { IslandClient, IslandHandle } from '@jwhenry123/mesh-islands';
import { InProcessWorker } from '@jwhenry123/mesh/sdk/testing/inProcessWorker';
import { MeshIslandComponent, MeshIslandDirective } from '../src/index';

vi.stubGlobal('Worker', InProcessWorker);
// In-process workers share one module graph — importing the worker entry
// performs its defineMonoWorker/TaskRegistry side effects at INIT_MEMORY.
InProcessWorker.handlerModules = [() => import('./fixtures/echo.worker')];

const renderWorker = () =>
  new Worker(new URL('./fixtures/echo.worker.ts', import.meta.url), { type: 'module' });

beforeAll(() => {
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('MeshIslandComponent', () => {
  it('mounts, relays events, re-props on input change, destroys cleanly', async () => {
    const emitted: Array<{ name: string; payload: unknown }> = [];
    let handle: IslandHandle | undefined;
    const client: IslandClient = connectIslandWorker({ worker: renderWorker });

    const fixture = TestBed.createComponent(MeshIslandComponent);
    fixture.componentRef.setInput('client', client);
    fixture.componentRef.setInput('app', 'echo');
    fixture.componentRef.setInput('props', { text: 'hello island' });
    fixture.componentRef.setInput('onEvent', (name: string, payload: unknown) => {
      emitted.push({ name, payload });
    });
    fixture.componentRef.setInput('onReady', (h: IslandHandle) => {
      handle = h;
    });
    fixture.detectChanges(); // ngOnInit → async mount

    // The island owns the <mesh-island> host element's contents.
    const host = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('hello island'),
    );
    // 'ready' emitted during the imperative build rode back in the mount batch.
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'ready')).toBe(true));
    expect(handle?.pid).toMatch(/^w-/);

    // props input change → ngOnChanges → updateProps → imperative rebuild.
    fixture.componentRef.setInput('props', { text: 'updated' });
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('updated'),
    );

    // Click → dispatch round-trip → emit → onEvent.
    host
      .querySelector('.ping')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'pinged')).toBe(true));

    // Re-delivering equal props costs no round-trip (JSON-identity dedupe).
    const opsApplied = handle!.opsApplied;
    fixture.componentRef.setInput('props', { text: 'updated' });
    fixture.detectChanges();
    await Promise.resolve();
    expect(handle!.opsApplied).toBe(opsApplied);

    // Destroy → island destroyed → last island out terminates the worker.
    const worker = InProcessWorker.created.at(-1)!;
    fixture.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });
});

describe('MeshIslandDirective', () => {
  // Attribute-selector form: [meshIsland] applies the same lifecycle to any
  // host element — here a plain div inside a host component's template.
  @Component({
    standalone: true,
    imports: [MeshIslandDirective],
    template: `<div meshIsland class="directive-host" [client]="client()" [props]="props()" [onEvent]="record"></div>`,
  })
  class DirectiveHostComponent {
    // Signal-backed state: in the zoneless harness a signal write is what
    // marks the view dirty for the next detectChanges() tick — a plain
    // field write would leave the binding stale.
    client = signal<IslandClient | undefined>(undefined);
    props = signal<Record<string, unknown> | undefined>(undefined);
    events: Array<{ name: string; payload: unknown }> = [];
    record = (name: string, payload: unknown): void => {
      this.events.push({ name, payload });
    };
  }

  it('mounts into the attributed host element and updates on re-binding', async () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(DirectiveHostComponent);
    fixture.componentInstance.client.set(connectIslandWorker({ worker: renderWorker }));
    fixture.componentInstance.props.set({ text: 'via directive' });
    fixture.detectChanges();

    const host = fixture.nativeElement.querySelector('.directive-host') as HTMLElement;
    expect(host.tagName).toBe('DIV');
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('via directive'),
    );
    await vi.waitFor(() =>
      expect(
        fixture.componentInstance.events.some((e) => e.name === 'ready'),
      ).toBe(true),
    );

    fixture.componentInstance.props.set({ text: 'directive updated' });
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(host.querySelector('.echo')?.textContent).toBe('directive updated'),
    );

    const worker = InProcessWorker.created.at(-1)!;
    fixture.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });
});
