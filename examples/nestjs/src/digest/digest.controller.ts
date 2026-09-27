import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { DigestService, digestMemory } from './digest.service';

@Controller('api/digest')
export class DigestController {
  constructor(@Inject(DigestService) private readonly digest: DigestService) {}

  /** CPU-bound hash chain — executed on a 'digest' pool worker. */
  @Post('hash')
  hash(@Body() body?: { input?: string; rounds?: number }) {
    return this.digest.hash(body?.input, body?.rounds);
  }

  /** Direct read of this pool's own shared counter — zero dispatch. */
  @Get('status')
  status() {
    return { jobsDone: digestMemory.jobsDone.read() };
  }

  /** The answering worker's threadId + its own injected telemetry. */
  @Get('worker')
  worker() {
    return this.digest.workerInfo();
  }
}
