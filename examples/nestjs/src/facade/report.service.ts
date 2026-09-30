import { Inject, Injectable } from '@nestjs/common';
import { threadId } from 'node:worker_threads';
import { AtollService } from '@atolljs/nestjs/decorators';
import {
  incidentsMemory,
  REGIONS,
  SERVICES,
  SEVERITIES,
  STATUSES,
  type Incident,
} from '@atolljs/incidents';
import { ScanTelemetry } from '../shared/scan-telemetry.service';

const CRITICAL = SEVERITIES.indexOf('critical');
const OPEN = STATUSES.indexOf('open');
const rec = {} as Incident;

/**
 * The service-level facade — the class IS the interop surface, mirroring
 * the Angular `islandComponent` pattern. One class-level @AtollService marks
 * EVERY method for offload: callers on the API thread inject this like any
 * provider and get Promise-returning proxies (`ReportService.method` task
 * ids); inside a 'reports' pool worker the same class resolves with real DI
 * and the bodies execute. No method decorators, no dispatch code — the
 * boundary is invisible at every call site.
 *
 * The 'reports' pool is message-only: its workers bind the incidents pool's
 * shared buffer via withSharedBuffer, so these scans read the same 1M
 * records the incidents pool seeded — two pools, one buffer.
 */
@Injectable()
@AtollService({ pool: 'reports' })
export class ReportService {
  constructor(@Inject(ScanTelemetry) private readonly telemetry: ScanTelemetry) {}

  /** Executive summary — a full-table aggregate over 1M shared records. */
  execSummary() {
    this.telemetry.note('execSummary');
    const t0 = performance.now();
    const conn = incidentsMemory.lists.incidents;
    const bySeverity = [0, 0, 0, 0];
    const byStatus = [0, 0, 0];
    const openByRegion = [0, 0, 0, 0, 0];
    let customers = 0;
    for (let i = 0; i < conn.recordCount; i++) {
      conn.readAt(i, rec, ['severity', 'status', 'region', 'customers']);
      bySeverity[rec.severity]++;
      byStatus[rec.status]++;
      if (rec.status === OPEN) openByRegion[rec.region]++;
      customers += rec.customers;
    }
    let topRegion = 0;
    for (let i = 1; i < openByRegion.length; i++) {
      if (openByRegion[i] > openByRegion[topRegion]) topRegion = i;
    }
    return {
      total: conn.recordCount,
      bySeverity: Object.fromEntries(SEVERITIES.map((s, i) => [s, bySeverity[i]])),
      byStatus: Object.fromEntries(STATUSES.map((s, i) => [s, byStatus[i]])),
      topOpenRegion: { region: REGIONS[topRegion], open: openByRegion[topRegion] },
      customersAffected: customers,
      ms: performance.now() - t0,
    };
  }

  /** Region-scoped report — a parameterized dispatch. */
  regionReport(region: string) {
    this.telemetry.note('regionReport');
    const t0 = performance.now();
    const idx = Math.max(0, REGIONS.indexOf(region as (typeof REGIONS)[number]));
    const conn = incidentsMemory.lists.incidents;
    let total = 0, open = 0, critical = 0;
    const byService = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < conn.recordCount; i++) {
      conn.readAt(i, rec, ['region', 'status', 'severity', 'service']);
      if (rec.region !== idx) continue;
      total++;
      if (rec.status === OPEN) open++;
      if (rec.severity === CRITICAL) critical++;
      byService[rec.service]++;
    }
    let topService = 0;
    for (let i = 1; i < byService.length; i++) {
      if (byService[i] > byService[topService]) topService = i;
    }
    return {
      region: REGIONS[idx],
      total,
      open,
      critical,
      topService: SERVICES[topService],
      ms: performance.now() - t0,
    };
  }

  /** Proof of context — this worker's threadId + its own injected state. */
  workerInfo() {
    return {
      threadId,
      scans: this.telemetry.scans,
      lastTask: this.telemetry.lastTask,
    };
  }
}
