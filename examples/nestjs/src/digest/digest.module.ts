import { Module } from '@nestjs/common';
import { DigestService } from './digest.service';
import { ScanTelemetry } from '../shared/scan-telemetry.service';

// Application boundary for the 'digest' pool: imported by AppModule so the
// controller can inject DigestService, and bootstrapped inside each digest
// worker by runMeshWorker — where the same providers resolve for real.
@Module({
  providers: [DigestService, ScanTelemetry],
  exports: [DigestService],
})
export class DigestMeshModule {}
