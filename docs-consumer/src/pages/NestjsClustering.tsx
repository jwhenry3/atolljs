import { CodeBlock } from '../components/CodeBlock';

const port = 3100;

const CLUSTER = `// src/main.ts — cluster the housed pool onto its own listener (Node ≥ 26)
import { getAtollPool } from '@atolljs/nestjs';
import { createHttpCluster } from '@atolljs/node/http';

const pool = getAtollPool('housed');
if (pool) {
  const transferPort = Number(process.env.TRANSFER_PORT ?? port + 1);
  createHttpCluster({
    pool,
    port: transferPort,
    onListen: () => log.log(\`housed api (clustered) → :\${transferPort}\`),
  });
  // Below Node 26 the call logs a notice and returns null — no
  // capability check needed.
}`;

export function NestjsClustering() {
  return (
    <article>
      <h1>NestJS — clustering</h1>
      <p className="lead">
        The housed pool&apos;s second front door (Node ≥ 26): a dedicated
        listener where the main thread accepts TCP connections and hands each
        socket to a housed worker <em>unparsed</em> — no parsing, no proxy
        hop, no serialization on the API thread.
      </p>

      <h2>Wiring</h2>
      <CodeBlock code={CLUSTER} file="main.ts" />
      <p>
        The worker side needs nothing — <code>serveHttp</code> in{' '}
        <code>housed.worker.ts</code> already accepts transferred sockets
        alongside its internal gateway port, so the same housed Nest app
        serves both entries.
      </p>

      <h2>Why a second port</h2>
      <p>
        Clustering routes per <em>connection</em>: the accepting thread never
        reads request bytes, so it can&apos;t split the app&apos;s port by
        URL path. <code>/api/housed/*</code> on the main port keeps using{' '}
        <code>proxyToWorker</code> (one origin for clients); the cluster
        listener is the zero-parse fast path for anything that can reach it.
      </p>

      <h2>Stickiness</h2>
      <p>
        A transferred socket pins for life, but separate connections
        round-robin — multi-connection session flows (socket.io&apos;s
        polling→upgrade, an HTTP call preceding a WS connection on the same
        worker) need <code>route: stickyByAddress()</code>, which hashes the
        client address onto a fixed worker. Details under{' '}
        <a href="#/fw-node/clustering">Node.js → Clustering</a>.
      </p>

      <h2>Live example</h2>
      <p>
        On Node ≥ 26, <code>examples/nestjs</code> serves the housed API
        clustered on <code>:{port + 1}</code> —{' '}
        <code>http://localhost:{port + 1}/api/housed/incidents/whoami</code>{' '}
        answers with a worker&apos;s threadId while the API thread never
        touched the request.
      </p>
    </article>
  );
}
