// Housed API — a controller that exists ONLY inside worker threads. The
// main Nest app never sees these routes: it proxies /api/housed/* into the
// workers' internal listeners, so decorators, DI, and guards all execute
// off the API thread. `worker` (threadId) stamps which worker answered.
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { threadId } from 'node:worker_threads';
import {
  REGIONS,
  SERVICES,
  SEVERITIES,
  STATUSES,
  type QueryArgs,
} from '@atolljs/incidents';
import { computeMetrics } from '@atolljs/incidents/service/computeMetrics';
import { queryIncidents } from '@atolljs/incidents/service/queryIncidents';
import { IncidentsAnalytics } from '../shared/incidents-analytics.service';

const toIndex = (list: readonly string[], value?: string) =>
  value == null || value === '' ? null : Math.max(0, list.indexOf(value));

@Controller('api/housed/incidents')
export class HousedIncidentsController {
  // The same @AtollTask-decorated service the API thread RPCs into — inside
  // a worker the pool registry is empty, so its methods run their real
  // bodies here; ScanTelemetry resolves as this worker's own instance.
  constructor(
    @Inject(IncidentsAnalytics) private readonly analytics: IncidentsAnalytics,
  ) {}

  /** Which pool worker owns this connection's requests. */
  @Get('whoami')
  whoami() {
    return { worker: threadId };
  }

  /** Full-table aggregate — computed inside the worker, no dispatch. */
  @Get('stats')
  stats() {
    return { ...computeMetrics.run(), worker: threadId };
  }

  /** Filtered/paged scan — same QueryArgs contract as the main controller. */
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
    return { ...queryIncidents.run(args), worker: threadId };
  }

  /** DI service call — this worker's own ScanTelemetry instance counts it. */
  @Get('hotspots')
  async hotspots(@Query('limit') limit?: string) {
    return {
      hotspots: await this.analytics.hotspots(limit ? parseInt(limit, 10) : undefined),
      worker: threadId,
    };
  }

  /** Per-worker state: each worker reports its own telemetry counters. */
  @Get('worker-telemetry')
  async workerTelemetry() {
    return { ...(await this.analytics.workerTelemetry()), worker: threadId };
  }
}
