import { Controller, Get, Inject, Param } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { ReportService } from './report.service';

/**
 * The facade in use — this controller has no atoll imports at all. Both
 * injected services resolve normally; every ReportService method is a
 * worker dispatch under the hood.
 */
@Controller('api/reports')
export class ReportController {
  constructor(
    @Inject(DashboardService) private readonly dashboard: DashboardService,
    @Inject(ReportService) private readonly reports: ReportService,
  ) {}

  /** Service→service interop: a main-thread service composing worker calls. */
  @Get('overview')
  overview() {
    return this.dashboard.overview();
  }

  /** Parameterized facade call — GET /api/reports/region/west */
  @Get('region/:region')
  region(@Param('region') region: string) {
    return this.reports.regionReport(region);
  }

  /** Which reports-pool worker answered + its own injected telemetry. */
  @Get('worker')
  worker() {
    return this.reports.workerInfo();
  }
}
