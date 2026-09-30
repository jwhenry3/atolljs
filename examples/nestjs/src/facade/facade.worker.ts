// Worker entry for the 'reports' pool — bundled standalone to
// dist/facade.worker.js. Message-only pool: the incidents buffer arrives via
// withSharedBuffer and binds BEFORE the Nest context boots, so ReportService
// scans the same memory the incidents pool seeded.
import { runAtollWorker } from '@atolljs/nestjs/worker';
import { bindSharedBuffer } from '@atolljs/node';
import { FacadeAtollModule } from './facade.module';

void (async () => {
  await bindSharedBuffer(); // the incidents pool's buffer — same memory
  await runAtollWorker(FacadeAtollModule);
})();
