import { Controller, Get, Inject, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { InjectAtollPool } from '@atolljs/nestjs';
import { workerClient, type WorkerPool } from '@atolljs/core/sdk';
import {
  incidentsMemory,
  REGIONS,
  SERVICES,
  SEVERITIES,
  STATUSES,
  type Incident,
  type IncidentsWorker,
  type QueryArgs,
} from '@atolljs/incidents';
import { IncidentsAnalytics } from './shared/incidents-analytics.service';

const toIndex = (list: readonly string[], value?: string) =>
  value == null || value === '' ? null : Math.max(0, list.indexOf(value));

@Controller('api/incidents')
export class IncidentsController {
  // The injected pool wrapped once as a typed client — calls read like the
  // worker's own method names. Factory form: resolves `this.pool` lazily
  // (field initializers run before the ctor's parameter-property assignment).
  private readonly incidents = workerClient<IncidentsWorker>(() => this.pool);

  // Explicit @Inject tokens — webpack/ts-loader does emit design:paramtypes,
  // so these are belt-and-suspenders rather than required.
  constructor(
    @InjectAtollPool('incidents') private readonly pool: WorkerPool,
    @Inject(IncidentsAnalytics) private readonly analytics: IncidentsAnalytics,
  ) {}

  /**
   * Seeds ~1M records through a pool task — the heavy write loop runs on a
   * worker while the HTTP thread stays free. GET /seed-progress reports the
   * shared counter in real time.
   */
  @Post('seed')
  seed() {
    return this.incidents.seedIncidents().then((ms) => ({ seeded: true, ms }));
  }

  @Get('seed-progress')
  seedProgress() {
    return { progress: incidentsMemory.signals.seedProgress.read() };
  }

  /** Aggregated metrics — computed on a worker over shared memory. */
  @Get('stats')
  stats() {
    return this.incidents.computeMetrics();
  }

  /**
   * Filtered/paged scan — dispatched as a task; the worker scans 1M records
   * in shared memory and returns only the page of rows.
   */
  @Get('query')
  query(@Query() q: Record<string, string>) {
    const args: QueryArgs = {
      offset: Math.max(0, parseInt(q.offset ?? '0', 10) || 0),
      limit: Math.min(200, Math.max(1, parseInt(q.limit ?? '50', 10) || 50)),
      sortBy: q.sortBy ?? null,
      sortDesc: q.sortDesc === 'true',
      severity: toIndex(SEVERITIES, q.severity),
      status: toIndex(STATUSES, q.status),
      region: toIndex(REGIONS, q.region),
      service: toIndex(SERVICES, q.service),
      search: q.search ?? '',
    };
    return this.incidents.queryIncidents(args);
  }

  /**
   * RPC-style offload: analytics.hotspots() is a normal async call here, but
   * @AtollTask dispatches it to the 'incidents' pool — the body runs inside a
   * worker's Nest app where the service's injected deps resolve for real.
   */
  @Get('hotspots')
  hotspots(@Query('limit') limit?: string) {
    return this.analytics.hotspots(limit ? parseInt(limit, 10) : undefined);
  }

  @Get('region-rollup')
  regionRollup() {
    return this.analytics.regionRollup();
  }

  /** Per-worker telemetry — whichever pool worker answers reports its own. */
  @Get('worker-telemetry')
  workerTelemetry() {
    return this.analytics.workerTelemetry();
  }

  /**
   * Direct shared-memory read on the API thread — no dispatch needed because
   * the contract is bound to the same buffer the pool writes.
   */
  @Get(':id')
  byId(@Param('id', ParseIntPipe) id: number) {
    const conn = incidentsMemory.lists.incidents;
    if (id < 0 || id >= conn.recordCount) {
      throw new NotFoundException(`incident ${id} out of range`);
    }
    const rec = {} as Incident;
    conn.readAt(id, rec);
    return rec;
  }
}
