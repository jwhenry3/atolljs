import { createHash } from 'node:crypto';
import { threadId } from 'node:worker_threads';
import { Inject, Injectable } from '@nestjs/common';
import { AtollTask } from '@atolljs/nestjs/decorators';
import { defineSharedMemory, field } from '@atolljs/core/sdk';
import { ScanTelemetry } from '../shared/scan-telemetry.service';

// The digest pool's own shared contract — a completely separate buffer from
// incidentsMemory. Both sides read it directly; the API thread's
// /digest/status endpoint never dispatches.
export const digestMemory = defineSharedMemory({
  jobsDone: field.number(),
});

/**
 * Second pool, same pattern: decorated methods dispatch to the 'digest'
 * pool, where runAtollWorker resolves this class with real DI (telemetry is
 * a per-worker instance there too).
 */
@Injectable()
export class DigestService {
  constructor(@Inject(ScanTelemetry) private readonly telemetry: ScanTelemetry) {}

  /** CPU-bound: chained SHA-256 rounds — the kind of work that stalls an event loop. */
  @AtollTask({ pool: 'digest' })
  async hash(input = 'incident-feed', rounds = 50_000) {
    this.telemetry.note('hash');
    const t0 = performance.now();
    let digest = input;
    for (let i = 0; i < rounds; i++) {
      digest = createHash('sha256').update(digest).digest('hex');
    }
    const jobs = digestMemory.jobsDone.read() + 1;
    digestMemory.jobsDone.write(jobs);
    return { hash: digest.slice(0, 16), rounds, ms: performance.now() - t0, jobsDone: jobs };
  }

  /**
   * Proof of execution context: threadId is 0 on the API thread and >0 inside
   * a worker_threads worker — and telemetry is this worker's own DI'd state.
   */
  @AtollTask({ pool: 'digest' })
  workerInfo() {
    return { threadId, scans: this.telemetry.scans, lastTask: this.telemetry.lastTask };
  }
}
