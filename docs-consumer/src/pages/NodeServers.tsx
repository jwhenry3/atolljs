import { CodeBlock } from '../components/CodeBlock';

const port = 3204;
const apiBase = `${window.location.protocol}//${window.location.hostname}:${port}`;

const APIS = [
  { name: 'createNodePool', signature: 'createNodePool(config)', desc: 'WorkerPool over node:worker_threads — adapter baked in; the worker: factory may return a raw Node Worker so new Worker(new URL(...)) stays bundler-detectable.' },
  { name: 'worker spec', signature: 'worker: path | URL | (() => Worker | NodeWorker)', desc: 'Pool worker declaration — TS source path, URL, or factory. Bundler-detectable literals keep webpack/esbuild emitting the entry as its own chunk.' },
  { name: 'workerClient', signature: 'workerClient<WorkerDef>(pool)', desc: 'Typed Proxy over the pool — calls read like the worker’s own methods; args/results cross postMessage.' },
  { name: 'createNodeWorker', signature: 'createNodeWorker(nodeWorker)', desc: 'Wraps a node:worker_threads.Worker for connectWorker or a hand-built WorkerPool.' },
  { name: '@atolljs/node/shim', signature: "import '@atolljs/node/shim'", desc: 'Worker-side entry shim — binds self = parentPort before defineWorker’s bootstrap evaluates. Always the first import.' },
  { name: 'routeHttpConnections', signature: 'routeHttpConnections({ pool, port, route?, onListen? })', desc: 'Pure socket transfer (Node ≥ 26): the main thread accepts TCP with pauseOnConnect and transfers each net.Socket to a pool worker — it never parses a byte of HTTP. Optional route hook picks the worker per connection; default round-robin.' },
  { name: 'serveHttp', signature: 'serveHttp(handler | http.Server, { listen? })', desc: 'Worker side: feeds transferred sockets into a worker-owned http.Server — any (req,res) listener works (Express, Koa .callback(), fastify().server). listen: 0 also binds an internal 127.0.0.1 port announced to the parent.' },
  { name: 'routeHttpGateway', signature: 'routeHttpGateway({ pool, port, routes, handler })', desc: 'Path-level ownership (any Node): the main thread parses HTTP once and proxies matching URL prefixes to worker internal ports; unmatched requests hit your handler. Pin /api/a/* to worker A, /api/b/* to worker B, serve the rest on main.' },
  { name: 'workerHttpPorts', signature: 'workerHttpPorts(pool)', desc: 'Announcement tracker for embedding — tracks each worker’s internal port over the pool channel; respawns re-announce and reclaim their routes. Pair with proxyToWorker.' },
  { name: 'proxyToWorker', signature: 'proxyToWorker({ pool, tracker, worker, to })', desc: 'Mountable request handler — resolves a worker per request (slot index or selector) and forwards to its internal port. Use as app.use(\'/prefix\', ...) in Express/Nest.' },
  { name: 'SOCKET_TRANSFER_SUPPORTED', signature: 'boolean', desc: 'Runtime capability gate for socket transfer — false below Node 26, where routeHttpConnections throws a clear error.' },
  { name: 'withSharedBuffer', signature: 'withSharedBuffer(spawn, buffer | () => buffer)', desc: 'Wraps a worker factory so every spawn is handed an existing pool’s sharedBuffer over the message channel — thunk evaluated per spawn, so respawns get it too.' },
  { name: 'bindSharedBuffer', signature: 'bindSharedBuffer(timeoutMs?)', desc: 'Worker side of the pair: resolves when the buffer arrives (or reads workerData.buffer), binds every defined contract, returns the buffer. For message-only pools that read another pool’s memory.' },
];

const POOL = `// main.ts — a pool with zero framework code
import { Worker } from 'node:worker_threads';
import { workerClient } from '@atolljs/core';
import { createNodePool } from '@atolljs/node';

const pool = createNodePool({
  worker: () => new Worker(new URL('../dist/offload.worker.js', import.meta.url)),
  sharedMemory: incidentsMemory,
  poolSize: 2,
});
const incidents = workerClient<IncidentsWorker>(pool);

await incidents.seedIncidents();            // task dispatch
incidentsMemory.signals.seedProgress.read(); // zero-dispatch shared read`;

const WORKER = `// offload.worker.ts — shim first, always
import '@atolljs/node/shim';
import '@atolljs/incidents/worker/incidents.worker'; // task handlers
import { serveHttp } from '@atolljs/node/http';
import { createApp } from './app';                  // Express inside the worker

serveHttp(createApp(), { listen: 0 });`;

const TRANSFER = `// main thread — pure connection offload (Node ≥ 26)
import { routeHttpConnections, SOCKET_TRANSFER_SUPPORTED } from '@atolljs/node/http';

if (SOCKET_TRANSFER_SUPPORTED) {
  routeHttpConnections({ pool, port: 3205 });
  // net.createServer({ pauseOnConnect: true }) accepts the socket,
  // transfers it round-robin — parsing, routing, handlers, and
  // response serialization all happen inside the worker's http.Server.
}`;

const GATEWAY = `// :3204 — gateway: split one listener by route prefix (any Node)
import { routeHttpGateway } from '@atolljs/node/http';

routeHttpGateway({
  pool,
  port: 3204,
  routes: [
    { prefix: '/api/a/', to: '/api/', worker: 0 },  // always worker A
    { prefix: '/api/b/', to: '/api/', worker: 1 },  // always worker B
  ],
  handler: mainHandler, // everything else stays on the API thread
});`;

const SHARED = `// Two pools, one buffer — a message-only pool reading another
// pool's contract memory (the housed-API pattern):
import { withSharedBuffer } from '@atolljs/node';

const housed = createNodePool({
  // NO sharedMemory here — a second pool would allocate a second buffer.
  worker: withSharedBuffer(
    () => new Worker(new URL('../dist/housed.worker.js', import.meta.url)),
    () => pool.sharedBuffer,   // resolved per spawn — respawns included
  ),
  poolSize: 2,
});

// housed.worker.ts — receive + bind before serving:
import { bindSharedBuffer } from '@atolljs/node';
await bindSharedBuffer(); // same SharedArrayBuffer as the incidents pool`;

export function NodeServers() {
  return (
    <article>
      <h1>Node worker servers</h1>
      <p className="lead">
        <code>@atolljs/node</code> puts a worker pool behind any Node program —
        and can move <em>HTTP itself</em> into workers. Connections or route
        prefixes are owned by workers, so request parsing, handler execution,
        and response serialization happen off the API thread.
      </p>

      <h2>Install</h2>
      <CodeBlock code="npm install @atolljs/core @atolljs/node" language="bash" />

      <h2>Pool + typed client</h2>
      <CodeBlock code={POOL} file="main.ts" />
      <p>
        The same pool answers both task dispatch and HTTP traffic — workers
        multiplex the pool's task protocol and the HTTP channel on one
        connection to the parent.
      </p>

      <h2>Worker entry — tasks and HTTP coexist</h2>
      <CodeBlock code={WORKER} file="offload.worker.ts" />
      <p>
        <code>serveHttp</code> attaches alongside the task bootstrap — one
        worker file, two protocols. The worker entry must be a bundled file
        here (<code>node:worker_threads</code> spawns plain Node processes,
        which don't see tsconfig <code>paths</code>/loader hooks) — esbuild
        produces <code>dist/offload.worker.js</code>. Under a bundler that
        rewrites <code>new Worker(new URL(...))</code> (webpack in the NestJS
        example) the factory points at the TS source instead.
      </p>

      <h2>Topology 1 — pure socket transfer (Node ≥ 26)</h2>
      <p>
        The strongest form: the main thread accepts TCP connections and
        transfers each <code>net.Socket</code> to a worker before reading a
        single byte — it is a dumb acceptor, and every part of the request
        lifecycle runs off-thread. Round-robin by default; a{' '}
        <code>route</code> hook can pick the worker per connection.
      </p>
      <CodeBlock code={TRANSFER} file="main.ts" />
      <p>
        Requires Node 26 or later — <code>net.Socket</code>/<code>net.Server</code>{' '}
        are only transferable from that version. On older runtimes{' '}
        <code>SOCKET_TRANSFER_SUPPORTED</code> is <code>false</code> and the
        call throws a clear capability error.
      </p>

      <h2>Topology 2 — the gateway (any Node)</h2>
      <p>
        Socket transfer routes per <em>connection</em> — it can't split one
        listener by URL path because the main thread never sees the request.
        To pin route prefixes to specific workers (or keep some routes on
        main), the main thread parses once and proxies to worker-owned
        internal listeners: <code>serveHttp(app, {'{'} listen: 0 {'}'})</code>{' '}
        announces a <code>127.0.0.1</code> port the gateway routes into.
      </p>
      <CodeBlock code={GATEWAY} file="main.ts" />
      <p>
        Respawned workers re-announce their port and reclaim their prefixes.
        For embedding into a host framework (NestJS, Fastify…) the same
        machinery comes as mountable pieces: <code>workerHttpPorts</code> +
        <code>proxyToWorker</code> — the housed-API pattern, below.
      </p>

      <h2>Two pools, one shared buffer</h2>
      <p>
        Worker-housed routes get their own pool and worker entry — but a
        pool's <code>sharedMemory</code> config allocates a{' '}
        <em>new</em> buffer. To let a message-only pool read another pool's
        contract memory, hand each spawned worker the existing buffer:
      </p>
      <CodeBlock code={SHARED} file="pools + worker entry" />
      <p>
        See the housed Nest API in <a href="#/fw-nestjs">the NestJS docs</a> —
        the same pair wraps a whole Nest application inside workers.
      </p>

      <h2>Node adapter API</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Export</th><th>Signature</th><th>What it does</th></tr>
        </thead>
        <tbody>
          {APIS.map((api) => (
            <tr key={api.name}>
              <td><code>{api.name}</code></td>
              <td><code>{api.signature}</code></td>
              <td>{api.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Live example</h2>
      <p>
        <code>examples/http-offload</code> runs both topologies — Express
        inside every worker — behind two listeners. Start it via{' '}
        <code>npm run serve:all</code>, then hit the gateway on port {port}:
      </p>
      <ul>
        <li><a href={`${apiBase}/api/whoami`} target="_blank" rel="noreferrer"><code>{apiBase}/api/whoami</code></a> — answered by the API thread</li>
        <li><a href={`${apiBase}/api/a/whoami`} target="_blank" rel="noreferrer"><code>{apiBase}/api/a/whoami</code></a> — always worker A</li>
        <li><a href={`${apiBase}/api/b/incidents/stats`} target="_blank" rel="noreferrer"><code>{apiBase}/api/b/incidents/stats</code></a> — worker-computed aggregates inside worker B</li>
        <li><a href={`${apiBase}/api/incidents/42`} target="_blank" rel="noreferrer"><code>{apiBase}/api/incidents/42</code></a> — direct shared-memory read, zero dispatch</li>
      </ul>
      <p>
        Port 3205 serves the same app through pure socket transfer when
        running Node ≥ 26.
      </p>

      <h2>Notes</h2>
      <ul>
        <li>No COOP/COEP needed — SharedArrayBuffer is always available in Node.</li>
        <li>Gateway/embedding requests transit the main thread once (parse + proxy); only socket transfer keeps the whole lifecycle off-thread.</li>
        <li>Close cleanly: <code>gateway.close()</code>/<code>routed.close()</code> then <code>pool.terminate()</code> on shutdown.</li>
        <li>Worker entries must stay bundler-detectable: literal <code>new Worker(new URL('./x.worker.ts', import.meta.url))</code> — never a computed URL.</li>
      </ul>
    </article>
  );
}
