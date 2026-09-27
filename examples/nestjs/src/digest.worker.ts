// Second worker entry — dist/digest.worker.js. Self-contained: no incidents
// contracts or task handlers; this pool's buffer only carries digestMemory.
import { runMeshWorker } from '@jwhenry123/mesh-nestjs/worker';
import { DigestMeshModule } from './digest/digest.module';

void runMeshWorker(DigestMeshModule);
