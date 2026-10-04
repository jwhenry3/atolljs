import { CodeBlock } from '../components/CodeBlock';
import { docHref } from '../link';

const TRANSFER = `// main thread: pure connection offload (Node ≥ 26)
import { createHttpCluster } from '@atolljs/node/http';

const cluster = createHttpCluster({ pool, port: 3205 });
// net.createServer({ pauseOnConnect: true }) accepts the socket,
// transfers it round-robin: parsing, routing, handlers, and
// response serialization all happen inside the worker's http.Server.
// Below Node 26 the call logs a notice and returns null: no
// capability check needed in caller code; cluster?.close() covers it.

// Sticky variant: multi-connection session flows (socket.io's
// polling→upgrade, HTTP↔WS pairs) need every connection from a client
// on the same worker. The acceptor can't read cookies, so the key is
// the client address: rendezvous hashing, nginx ip_hash style:
import { stickyByAddress } from '@atolljs/node/http';
createHttpCluster({ pool, port: 3206, route: stickyByAddress() });`;

const WORKER = `// offload.worker.ts: shim first, always
import '@atolljs/node/shim';
import '@atolljs/incidents/worker/incidents.worker'; // task handlers
import { serveHttp } from '@atolljs/node/http';
import { createApp } from './app';                  // Express inside the worker

serveHttp(createApp(), { listen: 0 });`;

export function NodeClustering() {
  return (
    <article>
      <h1>Node.js: clustering</h1>
      <p className="lead">
        The <code>cluster</code> module&apos;s accept-and-handoff, rebuilt on{' '}
        <code>worker_threads</code>: the main thread accepts TCP connections
        and transfers each <code>net.Socket</code> to a pool worker{' '}
        <em>before reading a single byte</em>. It is a dumb acceptor: every
        part of the request lifecycle runs off-thread.
      </p>

      <h2>Main thread</h2>
      <CodeBlock code={TRANSFER} file="main.ts" />

      <h2>Worker side</h2>
      <p>
        <code>serveHttp</code> attaches the transferred sockets to a
        worker-owned <code>http.Server</code> alongside the task bootstrap:
        one worker file, two protocols. Any <code>(req, res)</code> listener
        works: Express, Koa <code>.callback()</code>,{' '}
        <code>fastify().server</code>.
      </p>
      <CodeBlock code={WORKER} file="offload.worker.ts" />

      <h2>Semantics</h2>
      <ul>
        <li><strong>Per-connection routing</strong>: the acceptor never parses HTTP, so it can&apos;t split a port by URL path. Path-level ownership needs the <a href={docHref('fw-node/gateway')}>gateway</a> instead.</li>
        <li><strong>Round-robin by default</strong>: a <code>route(socket, workers)</code> option picks the worker per connection (e.g. hash on remote address). Returning <code>undefined</code> drops the connection.</li>
        <li><strong>Stickiness</strong>: one transferred socket pins for life, so a bare WS connection needs nothing. Multi-connection sessions (socket.io polling→upgrade, HTTP↔WS pairs) need <code>route: stickyByAddress()</code>, rendezvous hashing on the client address; removing a worker only remaps its own clients.</li>
        <li><strong>Self-gating</strong>, <code>net.Socket</code>/<code>net.Server</code> transfer landed in Node 26. Below it, <code>createHttpCluster</code> logs a notice and returns <code>null</code>: no caller-side check. (<code>SOCKET_TRANSFER_SUPPORTED</code> stays exported for tests/feature detection.)</li>
        <li><strong>Plain HTTP only</strong>: a TLS handshake would consume bytes on the accepting thread. Terminate TLS upstream or serve behind a proxy.</li>
        <li><strong>WebSockets ride along</strong>: the upgrade handshake lives inside the transferred socket, so a <code>WebSocketServer</code> attached to the worker&apos;s server works unchanged. See <a href={docHref('fw-node/websockets')}>WebSockets</a>.</li>
        <li><strong>Multiplexed workers</strong>: the same workers still answer <code>EXECUTE_TASK</code> dispatch; sockets queue behind whatever a worker is doing.</li>
      </ul>

      <h2>Live example</h2>
      <p>
        <code>examples/http-offload</code> serves the clustered listener on{' '}
        <code>:3205</code> (Node ≥ 26) next to the gateway on{' '}
        <code>:3204</code>: same workers, same app. The NestJS variant is{' '}
        <a href={docHref('fw-nestjs/clustering')}>Backend → NestJS → Clustering</a>.
      </p>
    </article>
  );
}
