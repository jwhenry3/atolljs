// Second worker entry — dist/digest.worker.js. Self-contained: no incidents
// contracts or task handlers; this pool's buffer only carries digestMemory.
// node/shim MUST be first: it binds self = parentPort before workerBootstrap.
import '@jwhenry123/mesh-node/shim';
import '@jwhenry123/mesh/sdk/worker/workerBootstrap';
import { runMeshWorker } from '@jwhenry123/mesh-nestjs/worker';
import { DigestMeshModule } from './digest/digest.module';

void runMeshWorker(DigestMeshModule);
