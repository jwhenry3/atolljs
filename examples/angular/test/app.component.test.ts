// @vitest-environment happy-dom
/**
 * Functional test: the angular example's AppComponent driving the real atoll
 * in-process. Instantiated inside TestBed's injection context so the signal
 * bindings, DestroyRef cleanup, and the component's effect() get real DI.
 *
 * One testing module for the whole suite — configureTestingModule is
 * once-per-instantiation, and each `it` builds a fresh AppComponent against
 * the same provider graph (the DI'd `incidents` client is shared; each
 * component owns its own taskState/signals).
 */
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WritableSignal } from '@angular/core';
import { provideAtoll } from '@atolljs/angular';
import { incidents } from '@atolljs/incidents';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('@atolljs/incidents/worker/incidents.worker'),
];

/** Signal-reading view of the component's protected surface. */
type Comp = {
  ready(): boolean;
  seedProgress(): number;
  page(): { rows: unknown[]; filtered: number; scanMs: number; sortMs: number } | null;
  metrics(): { critical: number } | null;
  rows(): unknown[];
  filtered(): number;
  isFetching(): boolean;
  pageCount(): number;
  timing(): string;
  query(): { offset: number; limit: number; sortBy: string | null; sortDesc: boolean; severity: number | null; status: number | null; region: number | null; service: number | null; search: string };
  pageIndex(): number;
  pageSize(): number;
  sortBy(): string | null;
  sortDesc(): boolean;
  severity: WritableSignal<string>;
  status: WritableSignal<string>;
  region: WritableSignal<string>;
  service: WritableSignal<string>;
  search(): string;
  debouncedSearch(): string;
  toggleSort(key: string): void;
  onFilter(sig: WritableSignal<string>, e: Event): void;
  onSearch(e: Event): void;
  prevPage(): void;
  nextPage(): void;
  onPageSize(e: Event): void;
};

let AppComponent: typeof import('../src/app.component').AppComponent;
const setup = (): Comp =>
  TestBed.runInInjectionContext(() => new AppComponent()) as unknown as Comp;

beforeAll(async () => {
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  TestBed.configureTestingModule({
    providers: [provideAtoll({ pools: [{ name: 'incidents', client: incidents }] })],
  });
  ({ AppComponent } = await import('../src/app.component'));
});

const selectEvent = (value: string) => ({ target: { value } }) as unknown as Event;

describe('AppComponent (angular example)', () => {
  it('seeds, reports progress, and serves table pages', async () => {
    const c = setup();
    // timing() before any page lands — `p && ms != null` false branch.
    expect(c.timing()).toBe('');
    expect(c.pageCount()).toBe(1); // Math.max(1, …) floor with no data
    await vi.waitFor(() => expect(c.ready()).toBe(true), { timeout: 20_000 });
    await vi.waitFor(() => expect(c.seedProgress()).toBe(100));
    await vi.waitFor(() => {
      expect(c.rows()).toHaveLength(50); // default pageSize
      expect(c.metrics()?.critical).toBeGreaterThan(0);
    });
  });

  it('toggleSort cycles asc → desc → cleared', async () => {
    const c = setup();
    await vi.waitFor(() => expect(c.ready()).toBe(true), { timeout: 20_000 });

    c.toggleSort('severity');
    expect(c.sortBy()).toBe('severity');
    expect(c.sortDesc()).toBe(false);
    expect(c.query().sortBy).toBe('severity');

    c.toggleSort('severity');
    expect(c.sortDesc()).toBe(true);

    c.toggleSort('severity');
    expect(c.sortBy()).toBeNull();
    expect(c.query().sortBy).toBeNull();
  });

  it('onFilter sets the domain signals and resets the page; query() maps "" → null', async () => {
    const c = setup();
    await vi.waitFor(() => expect(c.ready()).toBe(true), { timeout: 20_000 });

    // Default selects are '' → query() maps them to null.
    expect(c.query()).toMatchObject({ severity: null, status: null, region: null, service: null });

    c.onFilter(c.severity, selectEvent('3'));
    c.onFilter(c.status, selectEvent('1'));
    c.onFilter(c.region, selectEvent('2'));
    c.onFilter(c.service, selectEvent('4'));
    expect(c.pageIndex()).toBe(0);
    expect(c.query()).toMatchObject({ severity: 3, status: 1, region: 2, service: 4 });

    // The effect picked up the query change → a filtered scan comes back.
    await vi.waitFor(() => {
      const p = c.page();
      expect(p?.filtered).toBeGreaterThan(0);
      expect(p!.filtered).toBeLessThan(1_000_000);
    });
  });

  it('onSearch debounces into debouncedSearch; pager methods move the index', async () => {
    const c = setup();
    await vi.waitFor(() => expect(c.ready()).toBe(true), { timeout: 20_000 });
    await vi.waitFor(() => expect(c.rows().length).toBeGreaterThan(0));

    c.onSearch({ target: { value: 'nyc' } } as unknown as Event);
    expect(c.search()).toBe('NYC'); // uppercased eagerly
    await vi.waitFor(() => expect(c.debouncedSearch()).toBe('NYC'), { timeout: 5000 });
    await vi.waitFor(() => expect(c.query().search).toBe('NYC'));

    // Pager: nextPage only moves while a page exists beyond the current one.
    c.prevPage(); // at 0 — the guard's false branch
    expect(c.pageIndex()).toBe(0);
    await vi.waitFor(() => expect(c.pageCount()).toBeGreaterThan(1));
    c.nextPage();
    expect(c.pageIndex()).toBe(1);
    c.prevPage();
    expect(c.pageIndex()).toBe(0);

    c.onPageSize(selectEvent('25'));
    expect(c.pageSize()).toBe(25);
    expect(c.query().limit).toBe(25);
  });

  it('timing() reports scan + sort + round-trip once a page lands', async () => {
    const c = setup();
    await vi.waitFor(() => expect(c.ready()).toBe(true), { timeout: 20_000 });
    await vi.waitFor(() => expect(c.rows().length).toBeGreaterThan(0));
    await vi.waitFor(() =>
      expect(c.timing()).toMatch(/^scan \d+ms \+ sort \d+ms, round-trip \d+ms$/),
    );
    expect(c.isFetching()).toBe(false);
  });
});
