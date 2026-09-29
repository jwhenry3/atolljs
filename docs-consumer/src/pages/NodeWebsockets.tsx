import { CodeBlock } from '../components/CodeBlock';

const CLUSTER_WS = `// worker entry — the clustered listener needs no WS-specific code:
// the upgrade handshake rides inside the transferred socket, so attaching
// a ws server to the serveHttp server handles upgrades in-worker.
import { WebSocketServer } from 'ws';
import { serveHttp } from '@atolljs/node/http';

const server = serveHttp(createApp(), { listen: 0 });
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => { /* runs inside this worker */ });`;

const GATEWAY_WS = `// gateway — upgrade handshakes match the SAME prefix table as
// requests: the handshake replays to the owning worker's listener, then
// the two sockets splice. Frames never touch main-thread code again.
routeHttpGateway({
  pool,
  port: 3204,
  routes: [
    { prefix: '/api/a/', to: '/api/', worker: 0 },
    { prefix: '/ws/', to: '/ws/', worker: 1 },  // upgrades to /ws/* → worker B
  ],
  handler: mainHandler,
  onUpgrade: myOwnWsHandler, // optional: unmatched upgrades stay on main
});`;

const EMBED_WS = `// host framework — upgrades bypass middleware, so the proxy gets its
// own mount point on the server's 'upgrade' event:
import { proxyUpgradeToWorker } from '@atolljs/node/http';

server.on('upgrade', proxyUpgradeToWorker({
  pool,
  tracker,
  worker: (w) => w[i++ % w.length],
  // no mount stripping here — 'to' is a rewrite prefix, usually omitted
}));`;

export function NodeWebsockets() {
  return (
    <article>
      <h1>Node.js — WebSockets in workers</h1>
      <p className="lead">
        A WebSocket handshake is just an HTTP <code>Upgrade</code> request —
        which means both offload topologies carry it, differently. Clustered
        listeners need nothing at all; the gateway and embedded proxy tunnel
        the handshake, then splice the sockets.
      </p>

      <h2>Clustered listeners — zero code (mind stickiness)</h2>
      <p>
        A socket transferred by <code>createHttpCluster</code> arrives in the
        worker unparsed — handshake included. The worker&apos;s{' '}
        <code>http.Server</code> emits <code>&apos;upgrade&apos;</code>
        normally, so any ws implementation attached to it (or a{' '}
        <code>noServer</code> + manual <code>handleUpgrade</code>) works
        unchanged:
      </p>
      <CodeBlock code={CLUSTER_WS} file="offload.worker.ts" />
      <p>
        One caveat: a transferred socket pins for life, but{' '}
        <em>separate</em> connections round-robin. Multi-connection session
        flows — socket.io&apos;s polling→upgrade sequence, an HTTP call
        whose state must be visible to a later WS connection — need{' '}
        <code>route: stickyByAddress()</code> on the cluster (client-address
        hashing; the acceptor can&apos;t read cookies). The gateway topology
        sidesteps this entirely: a <code>/socket.io/</code> prefix pinned to
        one worker covers polling <em>and</em> upgrades.
      </p>

      <h2>Gateway — tunneled upgrades</h2>
      <p>
        Upgrade requests never reach <code>&apos;request&apos;</code>{' '}
        listeners — the gateway matches them against the same prefix table,
        replays the handshake verbatim to the owning worker&apos;s internal
        port (<code>rawHeaders</code> preserved, <code>host</code> rewritten),
        writes back the consumed <code>head</code> bytes, then splices the
        two sockets. After the handshake the main thread is out of the data
        path entirely.
      </p>
      <CodeBlock code={GATEWAY_WS} file="main.ts" />
      <ul>
        <li>Unmatched upgrades go to the <code>onUpgrade</code> fallback — e.g. a ws server living on the main thread — or the socket is destroyed (Node&apos;s default).</li>
        <li>The tunnel is byte-level: ws, socket.io, or any upgrade protocol works the same.</li>
      </ul>

      <h2>Embedded — <code>proxyUpgradeToWorker</code></h2>
      <p>
        Middleware (<code>app.use</code>) can&apos;t see handshakes, so the
        upgrade sibling attaches to the server&apos;s{' '}
        <code>&apos;upgrade&apos;</code> event directly:
      </p>
      <CodeBlock code={EMBED_WS} file="main.ts" />
      <p>
        Unlike <code>proxyToWorker</code>, the URL here is the original —
        nothing stripped it — so <code>to</code> acts as a rewrite prefix and
        is usually omitted. The NestJS mounting point is{' '}
        <a href="#/fw-nestjs/websockets">Backend → NestJS → WebSockets</a>.
      </p>
    </article>
  );
}
