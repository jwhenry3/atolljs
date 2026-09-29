// Node worker entry — the shim binds self = parentPort BEFORE
// workerBootstrap (inside defineWorker) evaluates, so import order is the
// contract. The incidents module registers its task handlers on import.
import '@atolljs/node/shim';
import '@atolljs/incidents/worker/incidents.worker';
