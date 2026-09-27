import { ChangeDetectionStrategy, Component, computed, effect, signal, type WritableSignal } from '@angular/core';
import { injectMeshPool, sharedValue, taskState } from '@jwhenry123/mesh-angular';
import {
  fmtDur,
  fmtInt,
  incidentColumns as columns,
  initIncidentsTask,
  incidentsMemory,
  queryIncidentsTask,
  REGIONS,
  SERVICES,
  SEVERITIES,
  STATUSES,
  type IncidentsPool,
  type QueryArgs,
} from '@jwhenry123/mesh-incidents';

const NULL_SEL = '';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  protected readonly columns = columns;
  protected readonly SEVERITIES = SEVERITIES;
  protected readonly STATUSES = STATUSES;
  protected readonly REGIONS = REGIONS;
  protected readonly SERVICES = SERVICES;
  protected readonly fmtInt = fmtInt;
  protected readonly fmtDur = fmtDur;
  protected readonly pageSizes = [25, 50, 100, 200];

  // Compose the generic Angular bindings with the incident domain: run init
  // once, stream seedProgress/metrics out of shared memory, and re-run the
  // page query whenever the query spec changes.
  private readonly seedTask = taskState(initIncidentsTask);
  private readonly pageTask = taskState(queryIncidentsTask);
  private readonly seedProgressValue = sharedValue(incidentsMemory, 'seedProgress');
  private readonly metricsValue = sharedValue(incidentsMemory, 'metrics');

  protected readonly ready = computed(() => this.seedTask.state().settled);
  protected readonly seedProgress = computed(() => this.seedProgressValue() ?? 0);
  protected readonly metrics = computed(() => this.metricsValue() ?? null);
  protected readonly page = computed(() => this.pageTask.state().data);
  protected readonly isFetching = computed(() => this.pageTask.state().pending);

  protected pageIndex = signal(0);
  protected pageSize = signal(50);
  protected sortBy = signal<string | null>(null);
  protected sortDesc = signal(false);
  protected severity = signal(NULL_SEL);
  protected status = signal(NULL_SEL);
  protected region = signal(NULL_SEL);
  protected service = signal(NULL_SEL);
  protected search = signal('');
  protected debouncedSearch = signal('');

  protected query = computed<QueryArgs>(() => ({
    offset: this.pageIndex() * this.pageSize(),
    limit: this.pageSize(),
    sortBy: this.sortBy(),
    sortDesc: this.sortDesc(),
    severity: this.severity() === NULL_SEL ? null : Number(this.severity()),
    status: this.status() === NULL_SEL ? null : Number(this.status()),
    region: this.region() === NULL_SEL ? null : Number(this.region()),
    service: this.service() === NULL_SEL ? null : Number(this.service()),
    search: this.debouncedSearch(),
  }));

  protected rows = computed(() => this.page()?.rows ?? []);
  protected filtered = computed(() => this.page()?.filtered ?? 0);
  protected total = computed(() => this.page()?.total ?? 0);
  protected pageCount = computed(() => Math.max(1, Math.ceil(this.filtered() / this.pageSize())));
  protected timing = computed(() => {
    const p = this.page();
    const ms = this.pageTask.state().elapsedMs;
    return p && ms != null
      ? `scan ${p.scanMs.toFixed(0)}ms + sort ${p.sortMs.toFixed(0)}ms, round-trip ${ms.toFixed(0)}ms`
      : '';
  });

  private debounce: ReturnType<typeof setTimeout> | undefined;

  // The DI-registered pool — spawned eagerly by provideMesh in main.ts, the
  // same instance the domain task helpers dispatch through.
  private readonly pool = injectMeshPool<IncidentsPool>('incidents');

  constructor() {
    // Kick off seeding — the pool is already up via provideMesh.
    initIncidentsTask.runOnce();
    // Latest-wins page fetch: re-runs on query changes once seeded; stale
    // responses are dropped by the task runner.
    effect(() => {
      const q = this.query();
      if (this.ready()) this.pageTask.run(q);
    });
  }

  protected toggleSort(key: string) {
    if (this.sortBy() !== key) { this.sortBy.set(key); this.sortDesc.set(false); }
    else if (!this.sortDesc()) this.sortDesc.set(true);
    else this.sortBy.set(null);
  }

  protected onFilter(sig: WritableSignal<string>, e: Event) {
    sig.set((e.target as HTMLSelectElement).value);
    this.pageIndex.set(0);
  }

  protected onSearch(e: Event) {
    const v = (e.target as HTMLInputElement).value.toUpperCase();
    this.search.set(v);
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { this.debouncedSearch.set(v); this.pageIndex.set(0); }, 300);
  }

  protected prevPage() { if (this.pageIndex() > 0) this.pageIndex.update((i) => i - 1); }
  protected nextPage() { if (this.pageIndex() < this.pageCount() - 1) this.pageIndex.update((i) => i + 1); }
  protected onPageSize(e: Event) { this.pageSize.set(Number((e.target as HTMLSelectElement).value)); }
}
