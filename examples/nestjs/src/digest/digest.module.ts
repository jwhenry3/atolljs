import { Module } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { AtollModule } from '@atolljs/nestjs';
import { DigestService, digestMemory } from './digest.service';
import { ScanTelemetry } from '../shared/scan-telemetry.service';

// Application boundary for the 'digest' pool: the module owns its worker
// (registerPool), the main app imports it so the controller can inject
// DigestService, and runAtollWorker bootstraps it inside each digest worker —
// where the same providers resolve and the pool provider returns null.
@Module({
  imports: [
    AtollModule.registerPool({
      name: 'digest',
      worker: () => new Worker(new URL('./digest.worker.js', import.meta.url)),
      sharedMemory: digestMemory,
      poolSize: 2,
    }),
  ],
  providers: [DigestService, ScanTelemetry],
  exports: [DigestService, AtollModule],
})
export class DigestAtollModule {}
