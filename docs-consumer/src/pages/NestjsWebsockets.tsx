import { CodeBlock } from '../components/CodeBlock';
import { docHref } from '../link';

const WS_MAIN = `// src/main.ts: upgrades bypass app.use, so the proxy mounts on the
// server's 'upgrade' event instead:
import { proxyUpgradeToWorker } from '@atolljs/node/http';

const pool = getAtollPool('housed');
const tracker = workerHttpPorts(pool);
let cursor = 0;

app.getHttpServer().on('upgrade',
  proxyUpgradeToWorker({
    pool,
    tracker,
    worker: (workers) => workers[cursor++ % workers.length],
  }),
);`;

const WS_GATEWAY = `// housed/housed-incidents.gateway.ts: a normal ws gateway that exists
// ONLY inside workers. The upgrade handshake replays to the worker's
// internal listener, then frames tunnel socket↔socket.
import { WebSocketGateway, SubscribeMessage } from '@nestjs/websockets';

@WebSocketGateway({ path: '/api/housed/ws' })
export class IncidentsGateway {
  @SubscribeMessage('ping')
  ping() {
    return { event: 'pong', worker: threadId }; // per-worker state works too
  }
}`;

export function NestjsWebsockets() {
  return (
    <article>
      <h1>NestJS, WebSockets in workers</h1>
      <p className="lead">
        WebSocket upgrades bypass middleware, <code>app.use</code> never
        sees them, so the housed proxy gets a second mounting point on the
        server&apos;s <code>&apos;upgrade&apos;</code> event.
      </p>

      <h2>Main thread</h2>
      <CodeBlock code={WS_MAIN} file="main.ts" />
      <p>
        The handshake replays to the resolved worker&apos;s internal listener
        (headers preserved, <code>host</code> rewritten), then the client and
        worker sockets splice: frames flow end-to-end without the API
        thread. Unlike <code>proxyToWorker</code> the URL isn&apos;t
        mount-stripped here, so <code>to</code> is a rewrite prefix:
        usually omitted.
      </p>

      <h2>Worker side, a real Nest gateway</h2>
      <p>
        Inside the housed app it&apos;s an ordinary{' '}
        <code>@WebSocketGateway</code>, attach the ws adapter to the server{' '}
        <code>serveHttp</code> returns and Nest&apos;s upgrade handling takes
        over, exactly as on a single process.
      </p>
      <CodeBlock code={WS_GATEWAY} file="housed/housed-incidents.gateway.ts" />

      <h2>Clustered listeners</h2>
      <p>
        On the <a href={docHref('fw-nestjs/clustering')}>clustered</a> port nothing is
        needed at all: the upgrade rides inside the transferred socket, so
        the worker&apos;s ws adapter handles it in-worker. The plumbing is
        documented under{' '}
        <a href={docHref('fw-node/websockets')}>Backend → Node.js → WebSockets</a>.
      </p>
    </article>
  );
}
