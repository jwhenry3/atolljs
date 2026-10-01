import type { ReactNode } from 'react';
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

/** Import-paths table — `pkg` links to npm; the Bundlephobia column links the size report. */
const IMPORT_PATHS: { pkg: string; contents: ReactNode }[] = [
  {
    pkg: '@atolljs/core',
    contents: <>Shared-memory contracts, worker pool, worker bootstrap, observables, tasks, codecs, logging</>,
  },
  {
    pkg: '@atolljs/react',
    contents: <><code>useObservable</code>, <code>useSharedValue</code>, <code>useTask</code> — React hooks</>,
  },
  {
    pkg: '@atolljs/vue',
    contents: <><code>useObservable</code>, <code>useSharedValue</code>, <code>useTask</code> — Ref-producing composables</>,
  },
  {
    pkg: '@atolljs/solidjs',
    contents: <><code>createObservable</code>, <code>createSharedValue</code>, <code>createTask</code> — Accessors</>,
  },
  {
    pkg: '@atolljs/svelte',
    contents: <><code>observableValue</code>, <code>sharedValue</code>, <code>taskState</code> — rune-backed state</>,
  },
  {
    pkg: '@atolljs/angular',
    contents: <><code>observableSignal</code>, <code>sharedValue</code>, <code>taskState</code> — Signals</>,
  },
  {
    pkg: '@atolljs/nextjs',
    contents: <>Re-exports the React binding — App Router safe, SSR-ready</>,
  },
  {
    pkg: '@atolljs/node',
    contents: <><code>createNodePool</code>, <code>createNodeWorker</code>, <code>/shim</code>, <code>withSharedBuffer</code>/<code>bindSharedBuffer</code>; <code>/http</code> adds <code>createHttpCluster</code>, <code>serveHttp</code>, <code>routeHttpGateway</code>, <code>proxyToWorker</code> — HTTP served from inside workers</>,
  },
  {
    pkg: '@atolljs/nestjs',
    contents: <><code>AtollModule</code>, <code>@AtollService</code>, <code>@AtollTask</code>, <code>runAtollWorker</code> — pools and housed APIs on <code>node:worker_threads</code></>,
  },
  {
    pkg: '@atolljs/islands',
    contents: <><code>mountIsland</code>, <code>connectIslandWorker</code>, <code>callbackProp</code>, <code>islandApp</code> — main-thread mounting; <code>/worker</code> exports <code>definePolyWorker</code>/<code>defineMonoWorker</code>, the proxy DOM, <code>emit</code> — framework-neutral, no renderer built in</>,
  },
  {
    pkg: '@atolljs/react-island',
    contents: <>React island shell — <code>&lt;Island&gt;</code>, <code>islandComponent</code>, <code>lazyIsland</code> + <code>react-reconciler</code> worker renderer</>,
  },
  {
    pkg: '@atolljs/vue-island',
    contents: <>Vue island shell — <code>AtollIsland</code>, <code>useIsland</code> + <code>createRenderer</code> worker renderer</>,
  },
  {
    pkg: '@atolljs/svelte-island',
    contents: <>Svelte island shell — <code>island</code> action, <code>createIslandState</code> + Svelte 5 worker renderer</>,
  },
  {
    pkg: '@atolljs/solid-island',
    contents: <>SolidJS island shell — <code>&lt;Island&gt;</code>, <code>createIsland</code>, <code>islandComponent</code>, <code>lazyIsland</code> + <code>solid-js/universal</code> worker renderer</>,
  },
  {
    pkg: '@atolljs/angular-island',
    contents: <>Angular island shell — <code>islandComponent</code> facades, <code>atollIsland</code> directive + <code>Renderer2</code> worker renderer</>,
  },
];

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
          <tr><th>Import path</th><th>Contents</th><th>Bundlephobia</th></tr>
        </thead>
        <tbody>
          {IMPORT_PATHS.map(({ pkg, contents }) => (
            <tr key={pkg}>
              <td className="nowrap"><PkgLink name={pkg} /></td>
              <td>{contents}</td>
              <td><PkgLink name={pkg} site="bundlephobia">size report ↗</PkgLink></td>
            </tr>
          ))}
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
