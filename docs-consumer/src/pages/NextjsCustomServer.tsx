import { CodeBlock } from '../components/CodeBlock';

const SERVER = `// server.mjs — self-hosted Next with a worker-thread front door (Node ≥ 26)
// Topology sketch: the clustered listener hands each TCP connection to a
// worker unparsed; every worker runs its own next() app instance and
// serves it through serveHttp.
import { createHttpCluster } from '@atolljs/node/http';
import { createNodePool } from '@atolljs/node';
import { Worker } from 'node:worker_threads';

const pool = createNodePool({
  worker: () => new Worker(new URL('./app.worker.mjs', import.meta.url)),
  poolSize: 'auto',
});
createHttpCluster({ pool, port: 3001, route: stickyByAddress() });`;

const WORKER = `// app.worker.mjs — each worker boots its own Next instance and houses it
import '@atolljs/node/shim';
import next from 'next';
import { serveHttp } from '@atolljs/node/http';

const app = next({ dev: false });
await app.prepare();
// serveHttp accepts transferred sockets AND any internal gateway port —
// every request render/parse/serialize happens off the API thread.
serveHttp(app.getRequestHandler());`;

const WS = `// WebSockets under a custom server — two placements:
//
// A) Upgrade proxy: main thread keeps the HTTP listener and forwards each
//    'upgrade' event into a worker. Fast to adopt; one proxy hop per frame.
//    httpServer.on('upgrade', (req, socket, head) =>
//      proxyUpgradeToWorker(req, socket, head));
//
// B) ws server inside the worker attached to serveHttp's listener — frames
//    never cross threads at all. This is how examples/nestjs runs WS; the
//    same serveHttp surface exists under createHttpCluster.
//
// Affinity: a transferred socket pins to one worker for life, but separate
// connections round-robin — multi-connection flows (socket.io's
// polling→upgrade) need createHttpCluster({ route: stickyByAddress() }) so
// the client address hashes onto one worker.`;

export function NextjsCustomServer() {
  return (
    <article>
      <h1>Next.js — custom server</h1>
      <p className="lead">
        Advanced, self-hosted, Node ≥ 26: run Next.js itself inside worker
        threads. The main thread becomes a TCP acceptor; each worker boots
        its own <code>next()</code> instance and serves it through{' '}
        <code>serveHttp</code>. Renders, route handlers, and JSON
        serialization all happen off the API thread.
      </p>

      <h2>Read this first</h2>
      <p>
        This is a <em>deployment topology</em>, not a supported Next.js
        integration — the example repo doesn&apos;t ship it, it requires
        standalone output and a custom server (which{' '}
        <a href="https://nextjs.org/docs/app/building-your-application/configuring/custom-server">
          Next.js documents as opt-out of some optimizations
        </a>
        ), and it gives up Vercel-style serverless entirely. Documented here
        because <code>createHttpCluster</code> + <code>serveHttp</code> make
        it mechanically possible: the housed handler is just{' '}
        <code>(req, res)</code> — the same shape as the NestJS housed app.
      </p>

      <h2>Topology</h2>
      <CodeBlock code={SERVER} file="server.mjs" />
      <CodeBlock code={WORKER} file="app.worker.mjs" />
      <p>
        Socket transfer is per-connection and unparsed — the acceptor
        can&apos;t route by URL path. If you need per-path routing (e.g.{' '}
        <code>/api/*</code> to workers, pages to main), keep Next on the
        main thread and put a parsing gateway in front; see{' '}
        <a href="#/fw-node/gateway">Node.js → Gateway routing</a> for the
        trade-off.
      </p>

      <h2>WebSockets</h2>
      <CodeBlock code={WS} file="websocket placement" />
      <p>
        Route-handler WebSocket endpoints don&apos;t exist in App Router —
        ws requires a custom server regardless of atoll. Once you have one,
        the worker-side placement keeps frame encode/decode and fan-out off
        the API thread. Full semantics:{' '}
        <a href="#/fw-node/websockets">Node.js → WebSockets</a>.
      </p>

      <h2>When it&apos;s worth it</h2>
      <p>
        Long-lived self-hosted deployments where the Node event loop is the
        bottleneck — heavy RSC serialization, high connection counts, or
        realtime fan-out sharing memory with a{' '}
        <a href="#/fw-nextjs-server/read-model">read-model pool</a>. For most
        apps the simpler wins are upstream: a pooled task API plus direct
        shared-memory reads cover the common cases without a custom server.
      </p>
    </article>
  );
}
