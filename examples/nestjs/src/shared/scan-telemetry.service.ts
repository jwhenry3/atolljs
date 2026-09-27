import { Injectable } from '@nestjs/common';

/**
 * Per-context state. On the main thread it's just an unused dependency; in
 * each worker it's real state accumulating across tasks — proving worker-side
 * DI resolves real instances.
 */
@Injectable()
export class ScanTelemetry {
  scans = 0;
  lastTask = '';

  note(task: string): void {
    this.scans++;
    this.lastTask = task;
  }
}
