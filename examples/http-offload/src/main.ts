// HTTP offload — two topologies over the same pool:
//
//   :3204 — gateway (any Node). The main thread parses HTTP once and routes
//           by prefix: /api/a/* → pool worker 0, /api/b/* → worker 1, and
//           everything else is served right here. That's the mixed case —
//           some routes owned by worker A, some by worker B, some by main.
//           Workers listen on internal 127.0.0.1 ports (serveHttp listen).
//
//   :3205 — clustering (Node ≥ 26). The main thread never parses
//           HTTP: accepted TCP sockets are transferred to workers round-robin,
//           where each worker's http.Server + Express own the lifecycle.
//
// The same two workers also answer task dispatch — the boot-time seed and
// POST /api/incidents/seed (main route) go through workerClient.
import { Worker } from 'node:worker_threads';
import { workerClient } from '@atolljs/core';
import { createNodePool } from '@atolljs/node';
import {
  createHttpCluster,
  routeHttpGateway,
} from '@atolljs/node/http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  INCIDENT_FIELDS,
  incidentsMemory,
  type Incident,
  type IncidentsWorker,
} from '@atolljs/incidents';

const pool = createNodePool({
  // poolSize: 2 — deterministic slots so the gateway can pin /api/a →
  // workers[0] and /api/b → workers[1] and speak of "worker A" / "worker B".
  worker: () => new Worker(new URL('../dist/offload.worker.js', import.meta.url)),
  sharedMemory: incidentsMemory,
  poolSize: 2,
});
const incidents = workerClient<IncidentsWorker>(pool);
const rec = {} as Incident;

/* ── main-thread routes: anything not proxied stays right here ─────────── */

const mainHandler = (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? '/';
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && url === '/api/whoami') {
    return json(200, { worker: 0 }); // 0 = the API thread itself
  }
  if (req.method === 'GET' && url === '/api/incidents/seed-progress') {
    return json(200, { progress: incidentsMemory.signals.seedProgress.read(), worker: 0 });
  }
  if (req.method === 'POST' && url === '/api/incidents/seed') {
    // A main-owned route that still offloads its work via task dispatch.
    return void incidents
      .seedIncidents()
      .then((ms) => json(200, { seeded: ms > 0, ms, worker: 0 }))
      .catch((err) => json(500, { error: String(err), worker: 0 }));
  }
  const m = /^\/api\/incidents\/(\d+)$/.exec(url);
  if (req.method === 'GET' && m) {
    const id = Number(m[1]);
    const conn = incidentsMemory.lists.incidents;
    if (id < 0 || id >= conn.recordCount) {
      return json(404, { error: `incident ${m[1]} not found`, worker: 0 });
    }
    return json(200, { ...conn.readAt(id, rec, INCIDENT_FIELDS), worker: 0 });
  }
  json(404, { error: `${req.method} ${url} not found`, worker: 0 });
};

/* ── :3204 — gateway: /api/a/* → worker A, /api/b/* → worker B ──────────── */

const gatewayPort = Number(process.env.PORT ?? 3204);
const gateway = routeHttpGateway({
  pool,
  port: gatewayPort,
  routes: [
    // 'to: /api/' — /api/a/incidents/query reaches the worker as
    // /api/incidents/query; the prefix only names the owner.
    { prefix: '/api/a/', to: '/api/', worker: 0 },
    { prefix: '/api/b/', to: '/api/', worker: 1 },
  ],
  handler: mainHandler,
  onListen: () => {
    console.log(`atoll http-offload gateway → http://localhost:${gatewayPort}/api/whoami`);
    console.log('  /api/a/* → worker A   /api/b/* → worker B   everything else → main thread');
    void incidents.seedIncidents().catch(console.error); // task dispatch, same pool
  },
});

/* ── :3205 — clustering (Node ≥ 26; createHttpCluster no-ops below it) ──── */

const cluster = createHttpCluster({
  pool,
  port: Number(process.env.TRANSFER_PORT ?? 3205),
  onListen: () =>
    console.log('  :3205 — clustered (connections routed to workers unparsed)'),
});

const shutdown = async () => {
  await Promise.all([gateway.close(), cluster?.close()]).catch(() => {});
  pool.terminate();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
