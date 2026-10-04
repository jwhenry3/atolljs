import { CodeBlock } from '../components/CodeBlock';
import { docHref } from '../link';

export function Devtools() {
  return (
    <article>
      <h1>Devtools</h1>
      <p className="lead">
        <code>@atolljs/devtools</code> is the observability surface for atoll
        apps: a live dashboard of every pool, worker, and island, plus task
        waterfalls, network traffic, shared-memory writes, and heap sampling.
        In the browser it needs <strong>no backend</strong>: events travel over
        a same-origin <code>BroadcastChannel</code> to a dashboard the vite
        plugin serves on your app's own origin.
      </p>

      <CodeBlock code={`npm install @atolljs/devtools`} language="bash" />
      <p>
        Or let the CLI do both steps :{' '}
        <code>atoll add devtools</code> installs the package and writes the init
        module for your host (browser, Node, or the Angular variant).
      </p>

      <h2>Enable it</h2>
      <CodeBlock
        file="main thread: before pools spawn"
        code={`import { initDevtools } from '@atolljs/devtools';

initDevtools({ session: { name: 'my-app' } });`}
      />
      <p>
        That's the whole setup, and it costs nothing until invited.{' '}
        <code>initDevtools</code> is a no-op unless the page was opened with{' '}
        <code>?__atoll_devtools</code> in the URL. With the param it connects
        the event sink <em>and</em> mounts the floating overlay; without it no
        sink, no broadcast, no overlay, and workers don't even install their
        forwarding probes.
      </p>
      <CodeBlock
        code={`my-app/?__atoll_devtools   → devtools on
my-app/                   → zero cost, nothing installed`}
      />

      <h2>What you get</h2>
      <ul>
        <li>
          <strong>The overlay flyout</strong>: a draggable, resizable panel
          anchored to a corner of your app. Its default tab is the <em>app
          map</em>: your session drawn as an atoll: main thread at the
          center, pools inside, workers mid-orbit, islands on the rim as real
          framework marks. Click any node to open its inspector; the other
          tabs carry compact versions of every table.
        </li>
        <li>
          <strong>The full page</strong>: open <code>/__atoll/</code> on your
          dev server (or <em>full page ↗</em> from the flyout) for the
          complete dashboard: task waterfalls per worker slot, fetch log with
          request inspection, shared-memory write rates, JS heap charts, the
          raw event log, and worker/island inspectors.
        </li>
        <li>
          <strong>Worker correlation for free</strong>: worker-side events
          ride the existing task channel and arrive stamped{' '}
          <code>poolId#slot</code>, so a fetch, a memory write, or a crash is
          attributed to the exact worker that did it.
        </li>
      </ul>

      <h2>Options</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Option</th><th>Type</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td><code>enabled</code></td><td><code>boolean</code></td><td>Override the <code>?__atoll_devtools</code> gate, force on or off</td></tr>
          <tr><td><code>overlay</code></td><td><code>boolean | object</code></td><td>Flyout, default on in a browser; <code>false</code> to skip it</td></tr>
          <tr><td><code>overlay.position</code></td><td><code>string</code></td><td><code>'topleft' | 'topcenter' | 'topright' | 'bottomleft' | 'bottomcenter' | 'bottomright'</code>, default <code>'bottomright'</code></td></tr>
          <tr><td><code>overlay.width / height</code></td><td><code>number</code></td><td>Initial flyout size, default 760×580</td></tr>
          <tr><td><code>session.name</code></td><td><code>string</code></td><td>Session label shown in the dashboard</td></tr>
          <tr><td><code>transport</code></td><td><code>'auto' | 'broadcast' | 'websocket'</code></td><td>Default <code>'auto'</code>, BroadcastChannel in a browser, WebSocket elsewhere</td></tr>
          <tr><td><code>url</code></td><td><code>string</code></td><td>Aggregate server address, implies the WebSocket transport</td></tr>
          <tr><td><code>network</code></td><td><code>boolean</code></td><td>Wrap <code>fetch()</code> to log requests, default on</td></tr>
          <tr><td><code>memory</code></td><td><code>boolean</code></td><td>Sample JS heap, default on</td></tr>
        </tbody>
      </table>
      <CodeBlock
        code={`initDevtools({
  session: { name: 'my-app' },
  overlay: { position: 'topleft' },
});`}
      />

      <h2>The aggregate server</h2>
      <p>
        BroadcastChannel scoping is structural: the local dashboard sees{' '}
        <em>only your app's origin</em>, which is the point. When you actually
        want several apps (or Node processes, which have no BroadcastChannel)
        in one view, opt into the standalone server:
      </p>
      <CodeBlock
        code={`npx atoll-devtools          # dashboard at http://127.0.0.1:4780

// in each app:
connectDevtools({ url: 'ws://127.0.0.1:4780/events' });`}
      />
      <p>
        The aggregate adds what a page can't: cross-origin sessions in one
        map, and post-mortem retention: ended sessions stay inspectable for
        30 minutes (pin one to keep it longer). The overlay still works; it
        always shows the local broadcast view.
      </p>

      <h2>Node.js apps</h2>
      <p>
        Node takes the WebSocket path automatically: no <code>window</code>,
        so no BroadcastChannel. The standalone server is the dashboard; the
        env var is the gate (there's no URL to carry the param):
      </p>
      <CodeBlock
        code={`// src/devtools.ts: a dedicated module, imported FIRST from
// your entry so the sink exists before any pool spawns.
import { initDevtools } from '@atolljs/devtools/node';
initDevtools({ session: { name: 'my-api' } });

// main.ts: import order matters: ESM evaluates imports before
// the entry body, and pools spawn inside sibling modules or
// NestFactory.create.
import './devtools';`}
      />
      <CodeBlock
        code={`npx atoll-devtools              # dashboard → http://127.0.0.1:4780
ATOLL_DEVTOOLS=1 npm run start  # the app streams to it`}
        language="bash"
      />
      <p>
        Express, Fastify, Nest, or plain <code>http</code>: anything using atoll
        pools shows up as a <code>runtime: 'node'</code> session, with the same
        per-worker attribution (<code>worker_threads</code> workers forward
        events over their message channel just like browser workers). Any
        Node version works: the client uses the global{' '}
        <code>WebSocket</code> on ≥ 22 and falls back to a bundled
        dependency-free client below it. Heap charts populate via{' '}
        <code>process.memoryUsage()</code>: per worker, not just main.
      </p>
      <p>
        Two things Node doesn't get: the overlay flyout and{' '}
        <code>/__atoll/</code> (no page to host them, the server is the UI),
        and inbound-HTTP instrumentation, the network view covers the{' '}
        <code>fetch()</code> calls your app <em>makes</em>, not the requests it
        serves.
      </p>

      <h2>Notes</h2>
      <ul>
        <li>
          <strong>Call <code>initDevtools()</code> before pools spawn.</strong>{' '}
          Workers learn whether to forward devtools events at INIT time: a
          worker spawned before the sink exists stays silent for its
          lifetime.
        </li>
        <li>
          <strong>Off means off.</strong> Without the URL param there is no
          sink, no BroadcastChannel traffic, and workers install no fetch or
          memory probes: hot paths like shared-memory writes skip building
          the event object entirely.
        </li>
        <li>
          <strong><code>fetch</code> only.</strong> The network view covers{' '}
          <code>fetch()</code> on main thread and in workers; XHR isn't
          instrumented.
        </li>
        <li>
          <strong>Per-worker heap is engine-dependent.</strong> It populates
          where the engine exposes memory APIs inside workers; the main-thread
          cluster breakdown uses{' '}
          <code>performance.measureUserAgentSpecificMemory</code>.
        </li>
        <li>
          Same cross-origin isolation rules as the rest of atoll: see{' '}
          <a href={docHref('hosting')}>Hosting &amp; headers</a> if the flyout
          renders blank behind strict COOP/COEP.
        </li>
      </ul>
    </article>
  );
}
