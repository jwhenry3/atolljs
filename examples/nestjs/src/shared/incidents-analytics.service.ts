import { Inject, Injectable } from '@nestjs/common';
// Deep-import the decorator — keeps the service file free of the binding's
// Nest module wiring; it's bundled into the worker too.
import { MeshService } from '@jwhenry123/mesh-nestjs/decorators';
import {
  incidentsMemory,
  REGIONS,
  SEVERITIES,
  STATUSES,
  type Incident,
} from '@jwhenry123/mesh-incidents';
import { ScanTelemetry } from './scan-telemetry.service';

const CRITICAL = SEVERITIES.indexOf('critical');
const OPEN = STATUSES.indexOf('open');
const rec = {} as Incident;

/**
 * One service, two runtimes. Calling a method on the API thread looks like
 * a normal async call but dispatches to the 'incidents' pool — RPC
 * semantics; the class-level @MeshService marks every method for offload.
 * Inside a worker, runMeshWorker resolves this class with DI (telemetry is
 * a real per-worker instance) and the bodies execute.
 *
 * @Inject on the ctor param is explicit — webpack/ts-loader does emit
 * design:paramtypes, so this is belt-and-suspenders rather than required.
 */
@Injectable()
@MeshService({ pool: 'incidents' })
export class IncidentsAnalytics {
  constructor(@Inject(ScanTelemetry) private readonly telemetry: ScanTelemetry) {}

  /** Top sites by open critical incidents. */
  hotspots(limit = 10): { site: string; open: number }[] {
    this.telemetry.note('hotspots');
    const conn = incidentsMemory.lists.incidents;
    const counts = new Map<string, number>();
    for (let i = 0; i < conn.recordCount; i++) {
      conn.readAt(i, rec, ['site', 'severity', 'status']);
      if (rec.severity === CRITICAL && rec.status === OPEN) {
        counts.set(rec.site, (counts.get(rec.site) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([site, open]) => ({ site, open }));
  }

  /** Open incident counts rolled up by region name. */
  regionRollup(): Record<string, number> {
    this.telemetry.note('regionRollup');
    const conn = incidentsMemory.lists.incidents;
    const rollup: Record<string, number> = {};
    for (let i = 0; i < conn.recordCount; i++) {
      conn.readAt(i, rec, ['region', 'status']);
      if (rec.status === OPEN) {
        const name = REGIONS[rec.region] ?? `region-${rec.region}`;
        rollup[name] = (rollup[name] ?? 0) + 1;
      }
    }
    return rollup;
  }

  /** This worker's own telemetry — real DI'd state living in the worker app. */
  workerTelemetry(): { scans: number; lastTask: string } {
    return { scans: this.telemetry.scans, lastTask: this.telemetry.lastTask };
  }
}
