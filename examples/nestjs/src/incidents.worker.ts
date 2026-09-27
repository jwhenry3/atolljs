// Node worker entry — bundled standalone to dist/incidents.worker.js.
// mesh-nestjs/worker is self-contained: its first imports bind self =
// parentPort and wire INIT_MEMORY / EXECUTE_TASK, so the entry is just the
// binding import + contract tasks + the module to bootstrap.
import { runMeshWorker } from '@jwhenry123/mesh-nestjs/worker';
import '@jwhenry123/mesh-incidents/worker/incidents.worker';
import { IncidentsMeshModule } from './shared/incidents-mesh.module';

// Boot a Nest application context inside this worker: IncidentsAnalytics and
// ScanTelemetry resolve with real DI, and every @MeshTask method registers
// as a TaskRegistry handler bound to that instance.
void runMeshWorker(IncidentsMeshModule);
