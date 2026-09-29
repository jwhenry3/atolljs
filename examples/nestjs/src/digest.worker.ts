// Second worker entry — dist/digest.worker.js. Self-contained: no incidents
// contracts or task handlers; this pool's buffer only carries digestMemory.
import { runAtollWorker } from '@atolljs/nestjs/worker';
import { DigestAtollModule } from './digest/digest.module';

void runAtollWorker(DigestAtollModule);
