import { CodeBlock } from '../components/CodeBlock';
import { PkgLink } from '../components/PkgLink';
import { docHref } from '../link';

const DIAGRAM = `main thread                                    worker(s)
┌─────────────────────────────┐   postMessage   ┌──────────────────────────┐
│ connectWorker client        │ ─── task ─────▶ │ defineWorker methods     │
│   counter.increment(n)      │ ◀── result ──── │   scan / sort / mutate   │
│                             │                 │        │                 │
│ connector reads / watches   │                 │        ▼                 │
└──────────────┬──────────────┘                 └──────────┬───────────────┘
               │               SharedArrayBuffer           │
               ▼        (same bytes, zero copy)            ▼
        ┌─────────────────────────────────────────────────────────┐
        │  contract: list rows · strings · objects · numbers    │
        └─────────────────────────────────────────────────────────┘`;

export function Overview() {
  return (
    <article>
      <h1>Overview</h1>
      <p className="lead">
        A worker atoll: pools and shared workers joined to your app through one
        shared-memory fabric. Threads share a fixed-layout{' '}
        <code>SharedArrayBuffer</code> contract; work is offloaded two ways —
        task <em>commands</em> (dispatch → result) and <em>state reactivity</em>{' '}
        (field changes drive behavior) — a fluid model that would deadlock or
        serialize in a single-threaded app.
      </p>

      <h2>Install</h2>
      <CodeBlock code={`npm install @atolljs/core`} language="bash" />
      <p>
        The core package ships the SDK — imported as{' '}
        <code>@atolljs/core</code>. Framework bindings are separate,
        independently published packages — <code>@atolljs/&lt;framework&gt;</code> —
        so you only install the framework you actually use.
      </p>

      <h2>How it fits together</h2>
      <CodeBlock code={DIAGRAM} language="plaintext" />
      <p>
        Three layers: <strong>contracts</strong> (<code>defineSharedMemory</code>{' '}
        + <code>field.*</code>) declare the memory layout once for both threads;
        the <strong>worker pair</strong> (<code>defineWorker</code> on the worker
        side, <code>connectWorker</code> on the main thread) dispatches typed
        method calls over a lazily-spawned pool;{' '}
        <strong>reactivity</strong> (<code>observe</code>, <code>watch</code>,{' '}
        <code>defineTask</code>) turns shared fields and task runs into
        subscribable snapshots the framework bindings adapt.
      </p>

      <h2>Import paths</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Import path</th><th>Contents</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><PkgLink name="@atolljs/core" /></td>
            <td>Shared-memory contracts, worker pool, worker bootstrap, observables, tasks, codecs, logging</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/react" /></td>
            <td><code>useObservable</code>, <code>useSharedValue</code>, <code>useTask</code> — React hooks</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/vue" /></td>
            <td><code>useObservable</code>, <code>useSharedValue</code>, <code>useTask</code> — Ref-producing composables</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/solidjs" /></td>
            <td><code>createObservable</code>, <code>createSharedValue</code>, <code>createTask</code> — Accessors</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/svelte" /></td>
            <td><code>observableValue</code>, <code>sharedValue</code>, <code>taskState</code> — rune-backed state</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/angular" /></td>
            <td><code>observableSignal</code>, <code>sharedValue</code>, <code>taskState</code> — Signals</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/nextjs" /></td>
            <td>Re-exports the React binding — App Router safe, SSR-ready</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/node" /></td>
            <td><code>createNodePool</code>, <code>createNodeWorker</code>, <code>/shim</code>, <code>withSharedBuffer</code>/<code>bindSharedBuffer</code>; <code>/http</code> adds <code>createHttpCluster</code>, <code>serveHttp</code>, <code>routeHttpGateway</code>, <code>proxyToWorker</code> — HTTP served from inside workers</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/nestjs" /></td>
            <td><code>AtollModule</code>, <code>@AtollService</code>, <code>@AtollTask</code>, <code>runAtollWorker</code> — pools and housed APIs on <code>node:worker_threads</code></td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/islands" /></td>
            <td><code>mountIsland</code>, <code>connectIslandWorker</code>, <code>callbackProp</code>, <code>islandApp</code> — main-thread mounting; <code>/worker</code> exports <code>definePolyWorker</code>/<code>defineMonoWorker</code>, the proxy DOM, <code>emit</code> — framework-neutral, no renderer built in</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/react-island" /></td>
            <td>React island shell — <code>&lt;Island&gt;</code>, <code>islandComponent</code>, <code>lazyIsland</code> + <code>react-reconciler</code> worker renderer</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/vue-island" /></td>
            <td>Vue island shell — <code>AtollIsland</code>, <code>useIsland</code> + <code>createRenderer</code> worker renderer</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/svelte-island" /></td>
            <td>Svelte island shell — <code>island</code> action, <code>createIslandState</code> + Svelte 5 worker renderer</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/solid-island" /></td>
            <td>SolidJS island shell — <code>&lt;Island&gt;</code>, <code>createIsland</code>, <code>islandComponent</code>, <code>lazyIsland</code> + <code>solid-js/universal</code> worker renderer</td>
          </tr>
          <tr>
            <td><PkgLink name="@atolljs/angular-island" /></td>
            <td>Angular island shell — <code>islandComponent</code> facades, <code>atollIsland</code> directive + <code>Renderer2</code> worker renderer</td>
          </tr>
        </tbody>
      </table>
      <p>
        Bindings contain zero domain code — they adapt the SDK's observable
        primitives to each framework's reactivity model. Your app owns the
        domain: contracts, worker handlers, and composition. The islands layer
        is separate: it moves the whole render tree into a worker — see{' '}
        <a href={docHref('islands')}>Islands</a> for when that's the right trade.
        On the server, <code>@atolljs/node/http</code> moves HTTP itself into
        workers — see <a href={docHref('fw-node/clustering')}>Node.js → Clustering</a>.
      </p>
    </article>
  );
}
