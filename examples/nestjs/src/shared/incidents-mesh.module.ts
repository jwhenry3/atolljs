import { Module } from '@nestjs/common';
import { IncidentsAnalytics } from './incidents-analytics.service';
import { ScanTelemetry } from './scan-telemetry.service';

/**
 * The application boundary shared by BOTH sides of the mesh:
 * - the main app imports it so controllers can inject IncidentsAnalytics —
 *   @MeshTask methods there dispatch to the pool (RPC semantics);
 * - the worker bootstraps it via runMeshWorker — the same providers resolve
 *   with real DI and the decorated bodies execute.
 */
@Module({
  providers: [ScanTelemetry, IncidentsAnalytics],
  exports: [IncidentsAnalytics],
})
export class IncidentsMeshModule {}
