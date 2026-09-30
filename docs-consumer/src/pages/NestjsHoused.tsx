import { CodeBlock } from '../components/CodeBlock';
import { docHref } from '../link';

const port = 3100;
const apiBase = () =>
  typeof window === 'undefined'
    ? `http://localhost:${port}`
    : `${window.location.protocol}//${window.location.hostname}:${port}`;

const HOUSED_MODULE = `// src/housed/housed-atoll.module.ts — the 'housed' pool is
// MESSAGE-ONLY: a sharedMemory here would allocate a SECOND buffer, so
// withSharedBuffer hands each spawned worker the incidents pool's
// buffer instead. Two pools' workers, one shared buffer.
import { Module } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { AtollModule, getAtollPool } from '@atolljs/nestjs';
import { withSharedBuffer } from '@atolljs/node';

@Module({
  imports: [
    AtollModule.registerPool({
      name: 'housed',
      worker: withSharedBuffer(
        () => new Worker(new URL('./housed.worker.ts', import.meta.url)),
        () => getAtollPool('incidents')?.sharedBuffer, // lazy — respawns included
      ),
      poolSize: 2,
    }),
  ],
})
export class HousedAtollModule {}`;

const HOUSED_WORKER = `// src/housed/housed.worker.ts — an HTTP worker, NOT a task worker
// (no runAtollWorker/bootstrap): bind the shared buffer, then boot a
// whole Nest app that exists ONLY inside workers.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { bindSharedBuffer } from '@atolljs/node';
import { serveHttp } from '@atolljs/node/http';
import { HousedApiModule } from './housed-api.module';

void (async () => {
  await bindSharedBuffer(); // the incidents pool's buffer — same memory
  const app = await NestFactory.create(HousedApiModule, { logger: ['warn', 'error'] });
  await app.init();
  serveHttp(app.getHttpServer(), { listen: 0 }); // internal port, announced to parent
})();`;

const HOUSED_MAIN = `// src/main.ts — /api/housed/* proxies into workers; the rest of
// the app keeps its own controllers on the API thread.
import { proxyToWorker, proxyUpgradeToWorker, createHttpCluster,
         workerHttpPorts } from '@atolljs/node/http';

const pool = getAtollPool('housed');
const tracker = workerHttpPorts(pool);
let cursor = 0;
app.use(
  '/api/housed',
  proxyToWorker({
    pool,
    tracker,
    to: '/api/housed', // express stripped the mount — restore it for worker routes
    worker: (workers) => workers[cursor++ % workers.length], // round-robin
  }),
);

// WebSocket upgrades bypass middleware — attach the upgrade sibling to the
// server itself (full URL, nothing stripped, so no 'to' needed).
app.getHttpServer().on('upgrade',
  proxyUpgradeToWorker({ pool, tracker, worker: (w) => w[cursor++ % w.length] }));

// Optional second listener: cluster the housed pool (Node ≥ 26). The main
// thread hands each accepted socket to a housed worker unparsed — zero
// parsing/serialization on the API thread. Per-CONNECTION routing can't
// split a port by path, so it lives on its own port. Below Node 26 the
// call logs a notice and returns null — no capability check needed.
createHttpCluster({ pool, port: port + 1 });`;

export function NestjsHoused() {
  return (
    <article>
      <h1>NestJS — housed APIs</h1>
      <p className="lead">
        A route subtree that lives <em>only</em> inside workers: a dedicated
        message-only pool boots a real Nest app per worker — decorators, DI,
        and guards intact — and the main app proxies a URL prefix into it.
        The whole controller stack executes off the API thread.
      </p>

      <h2>The message-only pool</h2>
      <p>
        The housed pool carries no <code>sharedMemory</code> of its own — a
        second pool would allocate a second buffer.{' '}
        <code>withSharedBuffer</code> threads the incidents pool&apos;s
        existing buffer into every spawned worker (respawns included), so
        housed controllers read the same contract state the API thread owns.
      </p>
      <CodeBlock code={HOUSED_MODULE} file="housed/housed-atoll.module.ts" />

      <h2>The worker — a whole Nest app</h2>
      <p>
        No <code>runAtollWorker</code> here: this is an HTTP worker, not a
        task worker. It binds the shared buffer, boots{' '}
        <code>HousedApiModule</code> with NestFactory, and hands its HTTP
        server to <code>serveHttp</code> — which listens on an internal{' '}
        <code>127.0.0.1</code> port (announced to the parent for the gateway
        path) <em>and</em> accepts transferred sockets (for clustering).
      </p>
      <CodeBlock code={HOUSED_WORKER} file="housed/housed.worker.ts" />

      <h2>Main thread — three entry points to the same routes</h2>
      <CodeBlock code={HOUSED_MAIN} file="main.ts" />
      <p>
        <code>proxyToWorker</code> keeps <code>/api/housed/*</code> on the
        app&apos;s own port — one origin for clients, one port to expose —
        at the cost of a parse + proxy hop on the API thread.{' '}
        <code>createHttpCluster</code> skips even that: its dedicated
        listener hands each connection to a worker unparsed, but
        per-connection routing can&apos;t share the app port by URL path, so
        it lives on <code>PORT + 1</code>. See{' '}
        <a href={docHref('fw-nestjs/clustering')}>Clustering</a> and{' '}
        <a href={docHref('fw-nestjs/websockets')}>WebSockets</a> for the other two
        entry points.
      </p>

      <h2>What executes where</h2>
      <p>
        Trace <code>GET :{port}/api/housed/incidents/whoami</code> through
        the proxy path — the stages split across two threads:
      </p>
      <ol>
        <li>
          <strong>API thread</strong> — accepts the connection, Express parses
          the request, <code>app.use(&apos;/api/housed&apos;, ...)</code>{' '}
          matches, and <code>proxyToWorker</code> picks a housed worker
          (round-robin <code>cursor</code>) and rewrites the mount-stripped
          path back to <code>/api/housed/...</code>.
        </li>
        <li>
          <strong>API thread → worker</strong> — the request is re-serialized
          onto that worker&apos;s internal <code>127.0.0.1</code> port (the
          one <code>serveHttp({'{'} listen: 0 {'}'})</code> announced via{' '}
          <code>workerHttpPorts</code>). Method, path, headers, and body all
          cross — this hop is the proxy&apos;s cost.
        </li>
        <li>
          <strong>Housed worker thread</strong> — the request lands on the
          worker&apos;s own HTTP server, so a complete Nest pipeline executes
          off-thread: guards, interceptors, DI resolution, the controller
          body — which reads the incidents buffer directly (the same
          SharedArrayBuffer <code>bindSharedBuffer()</code> attached, so the
          row read is a memory read, not a message).
        </li>
        <li>
          <strong>Worker → API thread → client</strong> — the response streams
          back over the internal port and the gateway pipes it to the client
          untouched — status, headers, the stamped <code>threadId</code> in
          the body.
        </li>
      </ol>
      <p>
        The clustered path on <code>:{port + 1}</code> removes steps 2 and
        4&apos;s application-level hop: the API thread hands the whole TCP
        socket to a worker unparsed, and that worker parses HTTP, runs the
        same Nest pipeline, and answers the client directly. The API thread
        only ever saw an opaque connection. Same controllers either way —
        the difference is purely how bytes reach the worker:
      </p>
      <table className="doc-table">
        <thead>
          <tr><th>Stage</th><th>App routes (<code>/api/*</code>)</th><th>Proxied (<code>/api/housed/*</code>)</th><th>Clustered (<code>:3101</code>)</th></tr>
        </thead>
        <tbody>
          <tr><td>Accept + parse</td><td>API thread</td><td>API thread</td><td>API thread accepts, worker parses</td></tr>
          <tr><td>Nest pipeline (guards, DI, controller)</td><td>API thread</td><td>housed worker</td><td>housed worker</td></tr>
          <tr><td>Incidents data access</td><td>memory read / task dispatch</td><td>direct memory read in worker</td><td>direct memory read in worker</td></tr>
          <tr><td>Response path</td><td>direct to client</td><td>worker → internal port → API thread → client</td><td>worker → client</td></tr>
        </tbody>
      </table>

      <h2>DI inside housed controllers</h2>
      <p>
        Housed controllers inject normally — <code>IncidentsAnalytics</code>&apos;s{' '}
        <code>@AtollService</code> methods find an empty pool registry
        in-worker and run their real bodies, so per-worker state (telemetry,
        caches) stays genuinely per-worker. The standalone pieces —{' '}
        <code>serveHttp</code>, <code>workerHttpPorts</code>,{' '}
        <code>proxyToWorker</code>, <code>withSharedBuffer</code>,{' '}
        <code>bindSharedBuffer</code> — come from <code>@atolljs/node</code>{' '}
        and work without Nest too.
      </p>

      <h2>Live example</h2>
      <p>
        <code>examples/nestjs</code> serves the housed API both ways. Start
        it via <code>npm run serve:all</code>, then:
      </p>
      <ul>
        <li><a href={`${apiBase()}/api/housed/incidents/whoami`} target="_blank" rel="noreferrer" data-port={port}><code>{apiBase()}/api/housed/incidents/whoami</code></a> — proxied on the app port; the response stamps the owning worker&apos;s threadId</li>
        <li><a href={`${apiBase()}/api/housed/incidents/worker-telemetry`} target="_blank" rel="noreferrer" data-port={port}><code>{apiBase()}/api/housed/incidents/worker-telemetry</code></a> — per-worker state from the housed Nest app</li>
        <li><code>:{port + 1}</code> — the clustered listener (Node ≥ 26): same routes, reached without the proxy hop</li>
      </ul>
    </article>
  );
}
