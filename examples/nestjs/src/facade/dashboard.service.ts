import { Inject, Injectable } from '@nestjs/common';
import { ReportService } from './report.service';

/**
 * A plain main-thread service — ZERO atoll imports. It injects ReportService
 * like any provider and awaits its methods; each call transparently
 * dispatches to a 'reports' pool worker. This is the service-level facade in
 * use: interop between main and worker is invisible to the consumer — a
 * service calls a service.
 *
 * Registered in FacadeAtollModule, so workers resolve it too — harmless:
 * nothing dispatches INTO it, and any worker-side call would fall through
 * to the local body (the pool registry is empty inside workers).
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(ReportService) private readonly reports: ReportService) {}

  /**
   * One HTTP response composed from two worker dispatches — the consumer
   * sees ordinary async methods, the pool sees two EXECUTE_TASK frames.
   */
  async overview() {
    const [summary, worker] = await Promise.all([
      this.reports.execSummary(),
      this.reports.workerInfo(),
    ]);
    return { ...summary, generatedBy: worker };
  }
}
