import { Module } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { AtollModule, getAtollPool } from '@atolljs/nestjs';
import { withSharedBuffer } from '@atolljs/node';
import { ScanTelemetry } from '../shared/scan-telemetry.service';
import { DashboardService } from './dashboard.service';
import { ReportService } from './report.service';

/**
 * Application boundary for the 'reports' pool — owns its worker domain the
 * same way the digest module does, with one twist: the pool is MESSAGE-ONLY
 * and shares the incidents pool's buffer instead of allocating a second one.
 * withSharedBuffer threads that buffer into each spawn (respawns included);
 * facade.worker.ts binds it, so ReportService scans the same 1M records.
 *
 * The module is the symmetric boundary: the main app imports it so the
 * controller and DashboardService inject ReportService, and each worker
 * bootstraps it via runAtollWorker — where the pool provider resolves to
 * null and the @AtollService bodies execute on the DI'd instance.
 */
@Module({
  imports: [
    AtollModule.registerPool({
      name: 'reports',
      // Resolved lazily — IncidentsAtollModule registers 'incidents' first.
      worker: withSharedBuffer(
        () => new Worker(new URL('./facade.worker.ts', import.meta.url)),
        () => getAtollPool('incidents')?.sharedBuffer,
      ),
      poolSize: 2,
    }),
  ],
  providers: [ScanTelemetry, ReportService, DashboardService],
  exports: [ReportService, DashboardService, AtollModule],
})
export class FacadeAtollModule {}
