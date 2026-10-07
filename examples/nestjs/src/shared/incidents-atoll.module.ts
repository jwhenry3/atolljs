import { Module } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { AtollModule } from '@atolljs/nestjs';
import { incidentsMemory } from '@atolljs/incidents';
import { IncidentsAnalytics } from './incidents-analytics.service';
import { ScanTelemetry } from './scan-telemetry.service';

/**
 * The application boundary shared by BOTH sides of the Atoll — it owns its
 * worker domain the BullModule.registerQueue way:
 * - `registerPool` declares the 'incidents' pool here instead of at the root
 *   module, keeping worker wiring inside the feature that owns it;
 * - the main app imports this module so controllers inject IncidentsAnalytics —
 *   @AtollTask methods there dispatch to the pool (RPC semantics);
 * - the worker bootstraps it via runAtollWorker — the same providers resolve
 *   with real DI, the decorated bodies execute, and the pool provider
 *   resolves to null (pools only spawn on the main thread).
 *
 * vite.config.ts emits every src/**\/*.worker.ts as dist/<name>.worker.js;
 * the URL literal resolves against dist/main.js at runtime.
 */
@Module({
  imports: [
    AtollModule.registerPool({
      name: 'incidents',
      worker: () => new Worker(new URL('./incidents.worker.js', import.meta.url)),
      sharedMemory: incidentsMemory,
      poolSize: 'auto',
    }),
  ],
  providers: [ScanTelemetry, IncidentsAnalytics],
  // Re-export AtollModule so importers get the ATOLL_POOL:incidents token.
  exports: [IncidentsAnalytics, AtollModule],
})
export class IncidentsAtollModule {}
