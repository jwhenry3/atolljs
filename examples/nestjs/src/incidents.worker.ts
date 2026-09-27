// Node worker entry — bundled standalone to dist/incidents.worker.js.
// node/shim MUST be first: it binds self = parentPort before workerBootstrap
// wires INIT_MEMORY / EXECUTE_TASK onto the MessagePort.
import '@jwhenry123/mesh-node/shim';
import '@jwhenry123/mesh-incidents/worker/incidents.worker';
import { runMeshWorker } from '@jwhenry123/mesh-nestjs/worker';
import { IncidentsMeshModule } from './shared/incidents-mesh.module';

// Boot a Nest application context inside this worker: IncidentsAnalytics and
// ScanTelemetry resolve with real DI, and every @MeshTask method registers
// as a TaskRegistry handler bound to that instance.
void runMeshWorker(IncidentsMeshModule);
