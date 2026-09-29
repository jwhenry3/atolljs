// Node worker entry — bundled standalone to dist/incidents.worker.js.
// atoll-nestjs/worker is self-contained: its first imports bind self =
// parentPort and wire INIT_MEMORY / EXECUTE_TASK, so the entry is just the
// binding import + contract tasks + the module to bootstrap.
import { runAtollWorker } from '@atolljs/nestjs/worker';
import '@atolljs/incidents/worker/incidents.worker';
import { IncidentsAtollModule } from './incidents-atoll.module';

// Boot a Nest application context inside this worker: IncidentsAnalytics and
// ScanTelemetry resolve with real DI, and every @AtollTask method registers
// as a TaskRegistry handler bound to that instance.
void runAtollWorker(IncidentsAtollModule);
