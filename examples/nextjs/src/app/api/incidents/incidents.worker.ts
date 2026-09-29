// Node worker_threads entry — the shim binds self = parentPort BEFORE the
// incidents worker module's workerBootstrap evaluates; import order is the
// contract. The module registers seedIncidents/queryIncidents/computeMetrics.
import '@atolljs/node/shim';
import '@atolljs/incidents/worker/incidents.worker';
