import { CodeBlock } from '../components/CodeBlock';

const port = 3204;
const apiBase = `${window.location.protocol}//${window.location.hostname}:${port}`;

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

const WORKER_LISTEN = `// worker entry — listen on an internal port and announce it
import { serveHttp } from '@atolljs/node/http';

serveHttp(createApp(), { listen: 0 }); // → parent gets {type:'HTTP_PORT',port}`;

const EMBED = `// Embedding into a host framework — mountable pieces instead of
// the standalone gateway:
import { workerHttpPorts, proxyToWorker } from '@atolljs/node/http';

const tracker = workerHttpPorts(pool);          // HTTP_PORT handshake tracker
app.use('/api/housed', proxyToWorker({
  pool, tracker, to: '/api/housed',             // restore the stripped mount
  worker: (w) => w[i++ % w.length],             // or a slot index to pin
}));`;

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

export function NodeGateway() {
  return (
    <article>
      <h1>Node.js — gateway routing</h1>
      <p className="lead">
        Path-level ownership on any Node version: the main thread parses HTTP
        once and proxies matched URL prefixes to worker-owned internal
        listeners. Some routes in worker A, some in worker B, the rest served
        right here.
      </p>

      <h2>Worker side</h2>
      <p>
        <code>serveHttp(app, {'{'} listen: 0 {'}'})</code> binds an internal{' '}
        <code>127.0.0.1</code> port and announces it to the parent — the
        gateway owns the only public port.
      </p>
      <CodeBlock code={WORKER_LISTEN} file="offload.worker.ts" />

      <h2>Main thread</h2>
      <CodeBlock code={GATEWAY} file="main.ts" />
      <ul>
        <li><code>worker:</code> is a slot index into the live <code>pool.workers</code> snapshot (or a selector fn) — a respawned worker re-announces its port and takes over its routes automatically.</li>
        <li><code>to:</code> rewrites the prefix — <code>/api/a/incidents/query</code> reaches the worker as <code>/api/incidents/query</code>; the prefix only names the owner.</li>
        <li>A route whose worker hasn&apos;t announced yet gets a 503.</li>
        <li>WebSocket upgrades match the same prefix table and tunnel end-to-end — see <a href="#/fw-node/websockets">WebSockets</a>.</li>
      </ul>

      <h2>Embedding in a host framework</h2>
      <p>
        When the main thread&apos;s HTTP stack belongs to Express/Nest/etc.,
        mount just the proxy piece instead of running the standalone gateway:{' '}
        <code>workerHttpPorts</code> tracks announcements (respawns
        re-announce on the next <code>refresh()</code>;{' '}
        <code>HTTP_PORT_QUERY</code> covers announcements that raced the
        attach) and <code>proxyToWorker</code> resolves the target worker per
        request.
      </p>
      <CodeBlock code={EMBED} file="main.ts" />
      <p>
        The NestJS version of this pattern — a whole Nest application housed
        inside workers — is <a href="#/fw-nestjs/housed">Backend → NestJS →
        Housed APIs</a>.
      </p>

      <h2>Two pools, one shared buffer</h2>
      <p>
        Worker-housed routes get their own pool and worker entry — but a
        pool&apos;s <code>sharedMemory</code> config allocates a{' '}
        <em>new</em> buffer. To let a message-only pool read another
        pool&apos;s contract memory, hand each spawned worker the existing
        buffer:
      </p>
      <CodeBlock code={SHARED} file="pools + worker entry" />

      <h2>Live example</h2>
      <p>
        <code>examples/http-offload</code> runs the gateway on port {port}.
        Start it via <code>npm run serve:all</code>, then hit:
      </p>
      <ul>
        <li><a href={`${apiBase}/api/whoami`} target="_blank" rel="noreferrer"><code>{apiBase}/api/whoami</code></a> — answered by the API thread</li>
        <li><a href={`${apiBase}/api/a/whoami`} target="_blank" rel="noreferrer"><code>{apiBase}/api/a/whoami</code></a> — always worker A</li>
        <li><a href={`${apiBase}/api/b/incidents/stats`} target="_blank" rel="noreferrer"><code>{apiBase}/api/b/incidents/stats</code></a> — worker-computed aggregates inside worker B</li>
        <li><a href={`${apiBase}/api/incidents/42`} target="_blank" rel="noreferrer"><code>{apiBase}/api/incidents/42</code></a> — direct shared-memory read, zero dispatch</li>
      </ul>
      <p>
        For zero main-thread parsing on Node ≥ 26, see{' '}
        <a href="#/fw-node/clustering">Clustering</a>.
      </p>
    </article>
  );
}
