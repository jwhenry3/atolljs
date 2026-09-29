// The housed API boundary — a real Nest module that lives ONLY inside
// workers. No registerPool import: pools only spawn on the main thread, so
// this module is pure HTTP surface (controller + providers).
import { Module } from '@nestjs/common';
import { IncidentsAnalytics } from '../shared/incidents-analytics.service';
import { ScanTelemetry } from '../shared/scan-telemetry.service';
import { HousedIncidentsController } from './housed-incidents.controller';

@Module({
  controllers: [HousedIncidentsController],
  providers: [ScanTelemetry, IncidentsAnalytics],
})
export class HousedApiModule {}
