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

initDevtools({ session: { name: 'my-app', framework: 'react' } });`}
      />
      <p>
        <code>framework</code> is optional: it puts your shell's mark on the
        app map's main-thread hub. Name your worker clients too (
        <code>connectWorker({'{'} name: 'search' {'}'})</code>): the name
        becomes the runner's id on the map, <code>search-w</code> for one
        dedicated worker or <code>search-p</code> for a pool.
      </p>
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
          center, pools (P) inside, workers on the rim. A worker hosting one
          island is drawn as that island, its real framework mark; a worker
          shared by several islands is a ring holding one node per island;
          a plain worker is a W. Nested workers link back to the island
          that spawned them. Click any node to open its inspector; the other
          tabs carry compact versions of every table.
        </li>
        <li>
          <strong>The full page</strong>: open <code>/__atoll/</code> on your
          dev server (or <em>full page ↗</em> from the flyout, which opens on
          the view you were looking at) for the complete dashboard: task
          waterfalls, main-thread jank, fetch inspection, live shared-memory
          values, the reactivity graph, audits, and the raw event log.
        </li>
        <li>
          <strong>Live controls</strong>: the dashboard can talk back. Kill a
          worker, inject delays and failures into a pool, edit an island's
          props, set watchpoints on shared memory.
        </li>
        <li>
          <strong>Worker correlation for free</strong>: worker-side events
          ride the existing task channel and arrive stamped{' '}
          <code>poolId#slot</code>, so a fetch, a memory write, or a crash is
          attributed to the exact worker that did it.
        </li>
      </ul>
      <p>
        <strong>Try it here.</strong> Every live demo embedded in these docs
        runs with devtools on: look for the <code>atoll devtools</code>{' '}
        button in a demo's corner, click it, and the flyout opens the app map
        for that demo (each demo ships its own <code>__atoll/</code>{' '}
        dashboard inside its mount). The demo's <code>↗</code> link opens it
        full-page with devtools active too.
      </p>

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
          <tr><td><code>overlay.src</code></td><td><code>string</code></td><td>Dashboard URL the flyout iframes, default <code>/__atoll/?mini=1</code></td></tr>
          <tr><td><code>overlay.startOpen</code></td><td><code>boolean</code></td><td>Start expanded, default: the remembered state, else collapsed</td></tr>
          <tr><td><code>overlay.persist</code></td><td><code>boolean | string</code></td><td>Remember position, size and open state in localStorage, default on; a string is the storage key</td></tr>
          <tr><td><code>overlay.hotkey</code></td><td><code>string | false</code></td><td>Shortcut that toggles the flyout, default <code>'Alt+Shift+D'</code></td></tr>
          <tr><td><code>session.name</code></td><td><code>string</code></td><td>Session label shown in the dashboard</td></tr>
          <tr><td><code>session.framework</code></td><td><code>string</code></td><td>Your shell's framework (<code>'react'</code>, <code>'vue'</code>, <code>'svelte'</code>, <code>'solid'</code>, <code>'angular'</code>, …), drawn on the app map's main-thread hub</td></tr>
          <tr><td><code>transport</code></td><td><code>'auto' | 'broadcast' | 'websocket'</code></td><td>Default <code>'auto'</code>, BroadcastChannel in a browser, WebSocket elsewhere</td></tr>
          <tr><td><code>url</code></td><td><code>string</code></td><td>Aggregate server address, implies the WebSocket transport</td></tr>
          <tr><td><code>network</code></td><td><code>boolean</code></td><td>Wrap <code>fetch()</code> to log requests, default on</td></tr>
          <tr><td><code>memory</code></td><td><code>boolean</code></td><td>Sample JS heap, default on</td></tr>
          <tr><td><code>jank</code></td><td><code>boolean</code></td><td>Report long frames and a once-a-second frame rate from the browser main thread, default on</td></tr>
        </tbody>
      </table>
      <p>
        <code>connectDevtools</code> takes the same <code>session</code>,{' '}
        <code>transport</code>, <code>url</code>, <code>network</code>,{' '}
        <code>memory</code> and <code>jank</code> options, without the URL gate
        or the overlay.
      </p>
      <CodeBlock
        code={`initDevtools({
  session: { name: 'my-app' },
  overlay: { position: 'topleft' },
});`}
      />

      <h2>A tour of the views</h2>
      <p>
        Every view opens with a one-line note on what it shows and what feeds
        it. When several sessions are connected, views follow the session
        selected in the sidebar.
      </p>
      <ul>
        <li>
          <strong>Dashboard</strong>: the app map over four tabs. <em>Overview</em>{' '}
          has KPI cards, a per-second task throughput chart, and an attention
          feed of respawns, worker errors and failed tasks. <em>Pools</em>,{' '}
          <em>Workers</em> and <em>Islands</em> are the entity tables. Clicking
          a worker opens the <em>worker inspector</em> (its own task lane, heap
          chart, fetches and errors). Clicking an island opens the{' '}
          <em>island inspector</em> with three tabs: <em>Elements</em> (the
          island's real DOM tree; hover a node to outline it in your page),{' '}
          <em>Props</em> (every props change, diffed against the previous one)
          and <em>Events</em> (what the island emitted, with payloads).
        </li>
        <li>
          <strong>Tasks</strong>: a waterfall of every task call per worker
          slot (queue wait, then run, colored by outcome) and per-task
          aggregates; click a task to drill in.
        </li>
        <li>
          <strong>Performance</strong>: main-thread long frames with their
          slowest scripts, frame rate over the last 60 seconds, and{' '}
          <em>message cost</em>: the estimated size of task arguments, task
          results, and island op batches crossing <code>postMessage</code>.
        </li>
        <li>
          <strong>Network</strong>: per-second channel traffic plus a log of
          real <code>fetch()</code> calls from the main thread and workers;
          click one for headers, body previews, and a timing breakdown.
        </li>
        <li>
          <strong>Memory</strong>: <em>Values</em> shows your shared-memory
          fields live, with snapshots to diff against and watchpoints.{' '}
          <em>Shared-memory writes</em> shows write rates per field and which
          worker wrote last. <em>JS heap</em> charts heap per session and per
          context.
        </li>
        <li>
          <strong>Reactivity</strong>: a graph from each shared-memory field
          through the watchers that cross threads to the slices and effects
          that read it, one lane per thread.
        </li>
        <li>
          <strong>Audits</strong>: live recommendations (oversized messages,
          saturated or idle pools, main-thread blocking, error and timeout
          rates, crash loops, heap pressure, a page that isn't cross-origin
          isolated), each with the evidence, a fix, and links to the entities
          involved. Mute a rule you don't care about.
        </li>
        <li>
          <strong>Log</strong>: the raw event stream with text, session and
          event-type filters, including atoll's own log lines at the level set
          with <code>setLogLevel</code>.
        </li>
      </ul>

      <h2>Live controls</h2>
      <p>
        The worker and island inspectors carry controls that run inside your
        app. They are available while the session is live and the app has the
        matching command registered; a disabled control's tooltip says why.
      </p>
      <ul>
        <li>
          <strong>Kill worker</strong>: crashes the worker through its real
          crash path. In-flight calls reject with{' '}
          <code>WorkerCrashedError</code> and the worker respawns if the
          client allows it: an easy way to test your recovery code.
        </li>
        <li>
          <strong>Chaos</strong>: add a delay before every call, fail a share
          of calls (<code>chaos: injected failure</code>), or time out a share
          of them through the real timeout path. It applies to the whole
          client until you clear it.
        </li>
        <li>
          <strong>Edit props</strong>: edit an island's props as JSON and
          apply them. Callbacks appear as <code>"[fn]"</code>; leave the
          placeholder and the original callback stays wired.
        </li>
        <li>
          <strong>Push / Poll</strong>: switch an island's transport mode.
        </li>
        <li>
          <strong>Watchpoints</strong> (Memory › Values): pick a field and a
          rule (<code>change</code>, <code>&gt; n</code>,{' '}
          <code>&lt; n</code>, <code>&gt;= n</code>, <code>&lt;= n</code>,{' '}
          <code>== v</code>, <code>!= v</code>) and every matching write is
          logged with its value. Writes from workers are checked when the main
          thread sees the change, so a fast burst reports its latest value.
        </li>
      </ul>
      <p>
        Pools and islands started inside another worker show up everywhere
        but can't be controlled: their handles live in that worker.
      </p>

      <h2>Browser Performance panel</h2>
      <p>
        With devtools on, atoll also records User Timing measures, so a
        Chrome Performance recording shows its work in an{' '}
        <code>atoll</code> track group next to your frames:{' '}
        <code>atoll task &lt;taskId&gt;</code> on the main thread (one track
        per worker client), <code>atoll run &lt;taskId&gt;</code> inside the
        worker, and <code>atoll replay &lt;instance&gt;</code> for each island
        DOM update. The dashboard's flyout runs on your page's main thread, so
        its own rendering counts toward jank: measure with the full page open
        instead.
      </p>

      <h2>Record, export, replay</h2>
      <p>
        The dashboard keeps a rolling capture of recent events. <em>● Rec</em>{' '}
        starts an explicit recording; <em>Export</em> downloads the recording
        (or the rolling capture) as JSON, just the selected session when one
        is selected. <em>Import</em> (or drop the file on the window) replays
        it: every view rebuilds as it was, with play, speed, and a scrubber.
        Replayed sessions are marked <code>⏺</code> and never send commands to
        a live app. Attach a recording to a bug report and anyone can open it
        in their own dashboard.
      </p>

      <h2>Keyboard and links</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Key</th><th>Action</th></tr>
        </thead>
        <tbody>
          <tr><td><code>Ctrl+K</code> / <code>⌘K</code></td><td>Command palette: jump to any view, island, worker, pool, or command</td></tr>
          <tr><td><code>g</code> then a letter</td><td>Go to a view (<code>d</code> Dashboard, <code>t</code> Tasks, <code>p</code> Performance, <code>n</code> Network, <code>m</code> Memory, <code>r</code> Reactivity, <code>a</code> Audits, <code>l</code> Log)</td></tr>
          <tr><td><code>[</code> / <code>]</code></td><td>Previous / next sub-tab</td></tr>
          <tr><td><code>/</code></td><td>Focus the view's filter box</td></tr>
          <tr><td><code>?</code></td><td>All shortcuts and what each view is for</td></tr>
          <tr><td><code>Alt+Shift+D</code></td><td>Show or hide the flyout, from your page or inside it</td></tr>
        </tbody>
      </table>
      <p>
        The address hash tracks the current view and inspector, for example{' '}
        <code>/__atoll/#/dashboard/tv-island?island=…</code>, so a reload or a
        shared link opens the same spot. In the flyout the hash never adds
        entries to your page's history.
      </p>

      <h2>Chrome DevTools panel</h2>
      <p>
        The same dashboard can live inside Chrome DevTools as an{' '}
        <strong>atoll</strong> panel for the inspected tab, so you don't need
        the flyout or a second tab. Updates are pushed as they happen: a small
        content script joins your page's devtools channel only while the
        panel is open, and stays idle otherwise.
      </p>
      <p>
        Because that script is declared for every site, Chrome shows a{' '}
        <em>Read and change all your data on all websites</em> warning when
        you install the extension. It never reads the page itself, only the
        atoll devtools channel. Tabs that were already open when you
        installed it need a reload before the panel can connect.
      </p>
      <CodeBlock code={`npm run build:extension   # → packages/devtools-extension/dist`} language="bash" />
      <p>
        Open <code>chrome://extensions</code>, enable Developer mode, choose{' '}
        <em>Load unpacked</em>, and pick that folder. Your app still needs
        devtools on (<code>?__atoll_devtools</code> with{' '}
        <code>initDevtools()</code>). Inside DevTools the palette also opens
        with <code>Ctrl+Shift+K</code>, since DevTools claims{' '}
        <code>Ctrl+K</code>. Sessions from the aggregate server and Node apps
        don't appear there; use the standalone dashboard for those.
      </p>

      <h2>Export to OpenTelemetry</h2>
      <p>
        Send the same telemetry to Jaeger, Tempo, Honeycomb, Grafana, or an
        OpenTelemetry Collector. The exporter speaks OTLP/HTTP JSON with no
        extra dependencies, and runs alongside the dashboard or on its own:
      </p>
      <CodeBlock
        file="main thread: before pools spawn"
        code={`import { exportOtel } from '@atolljs/devtools/otel';

const otel = exportOtel({ endpoint: 'http://localhost:4318', serviceName: 'my-app' });
// on shutdown (Node): await otel.close();`}
      />
      <p>
        Task calls, island round trips, and fetches become spans; task
        outcomes, durations, queue wait, heap, long frames, and shared-memory
        writes become metrics; SDK logs and worker crashes become log
        records. To forward everything the aggregate server receives
        instead, start it with <code>npx atoll-devtools --otlp http://localhost:4318</code>.
        Each task call is its own trace: spans aren't parented to your app's
        own traces.
      </p>

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

      <h2>Deploying in production</h2>
      <p>
        The dashboard is a static <code>index.html</code> +{' '}
        <code>main.js</code> with no build step, so there are two ways to put
        it in front of a deployed app:
      </p>
      <p>
        <strong>Same-origin, zero backend.</strong> Ship the dashboard app as
        part of your site at <code>/__atoll/</code>. With the vite plugin
        this is automatic: when your app bundles{' '}
        <code>@atolljs/devtools</code>, <code>vite build</code> emits the
        dashboard into <code>&lt;outDir&gt;/__atoll/</code>, already set to
        listen on BroadcastChannel, so the flyout keeps working. Opt out, or
        force it on and move it:
      </p>
      <CodeBlock
        file="vite.config.ts"
        code={`atoll({ devtools: { build: false } }) // never ship /__atoll/
atoll({ devtools: { build: true, dir: 'debug/devtools' } })`}
      />
      <p>
        Without vite, copy <code>packages/devtools/app/</code> to{' '}
        <code>/__atoll/</code> yourself and add the flag before{' '}
        <code>&lt;/head&gt;</code>:
      </p>
      <CodeBlock
        file="/__atoll/index.html"
        code={`<script>window.__ATOLL_TRANSPORT="broadcast"</script>`}
      />
      <p>
        Then <code>?__atoll_devtools</code> and the overlay work exactly like
        development, and same-origin scoping is structural: the dashboard can
        only hear apps on your origin. Serve your app's COOP/COEP headers on{' '}
        <code>/__atoll/</code> too (the dev middleware echoes them for you; a
        static host won't), or the flyout iframe lands in a separate
        browsing-context group and renders blank.
      </p>
      <p>
        <strong>Hosted aggregate.</strong> For cross-origin sessions and Node
        processes in one view, run the standalone server where you can reach
        it and point apps at it (<code>url</code> implies the WebSocket
        transport):
      </p>
      <CodeBlock
        code={`// devtools-server: behind your proxy's TLS + auth
import { createDevtoolsServer } from '@atolljs/devtools/server';
createDevtoolsServer({ host: '0.0.0.0', port: 4780 });

// in each deployed app:
initDevtools({
  transport: 'websocket',
  url: 'wss://devtools.internal.example.com/events',
  session: { name: 'checkout-web' },
  overlay: { src: 'https://devtools.internal.example.com/?mini=1' },
});`}
      />
      <p>
        The cross-origin <code>overlay.src</code> works because the aggregate
        dashboard reads its own server's <code>/view</code> socket, not the
        page's BroadcastChannel. Two cautions: the server ships with{' '}
        <strong>no authentication</strong> (loopback is the designed
        deployment: put auth and TLS in front when you host it), and{' '}
        <code>?__atoll_devtools</code> still activates in production builds:
        under the aggregate topology, gate on <code>enabled</code> instead so
        visitors can't stream events to your server by appending the param.
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
