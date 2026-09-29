import { CodeBlock } from '../components/CodeBlock';

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
      <h1>Atoll — the Worker Atoll</h1>
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
            <td><code>@atolljs/core</code></td>
            <td>Shared-memory contracts, worker pool, worker bootstrap, observables, tasks, codecs, logging</td>
          </tr>
          <tr>
            <td><code>@atolljs/react</code></td>
            <td><code>useObservable</code>, <code>useSharedValue</code>, <code>useTask</code> — React hooks</td>
          </tr>
          <tr>
            <td><code>@atolljs/vue</code></td>
            <td><code>useObservable</code>, <code>useSharedValue</code>, <code>useTask</code> — Ref-producing composables</td>
          </tr>
          <tr>
            <td><code>@atolljs/solidjs</code></td>
            <td><code>createObservable</code>, <code>createSharedValue</code>, <code>createTask</code> — Accessors</td>
          </tr>
          <tr>
            <td><code>@atolljs/svelte</code></td>
            <td><code>observableValue</code>, <code>sharedValue</code>, <code>taskState</code> — rune-backed state</td>
          </tr>
          <tr>
            <td><code>@atolljs/angular</code></td>
            <td><code>observableSignal</code>, <code>sharedValue</code>, <code>taskState</code> — Signals</td>
          </tr>
          <tr>
            <td><code>@atolljs/nextjs</code></td>
            <td>Re-exports the React binding — App Router safe, SSR-ready</td>
          </tr>
          <tr>
            <td><code>@atolljs/islands</code></td>
            <td><code>mountIsland</code>, <code>connectIslandWorker</code>, <code>callbackProp</code>, <code>islandApp</code> — main-thread mounting; <code>/worker</code> exports <code>definePolyWorker</code>/<code>defineMonoWorker</code>, the proxy DOM, <code>emit</code> — framework-neutral, no renderer built in</td>
          </tr>
          <tr>
            <td><code>@atolljs/*-island</code></td>
            <td>Shell components + worker renderers for islands — <code>react-island</code> (<code>&lt;Island&gt;</code>, <code>lazyIsland</code>, <code>islandComponent</code>), <code>vue-island</code> (<code>AtollIsland</code>, <code>useIsland</code>), <code>svelte-island</code> (<code>island</code> action), <code>solid-island</code> (<code>&lt;Island&gt;</code>, <code>createIsland</code>), <code>angular-island</code> (<code>atollIsland</code> directive)</td>
          </tr>
        </tbody>
      </table>
      <p>
        Bindings contain zero domain code — they adapt the SDK's observable
        primitives to each framework's reactivity model. Your app owns the
        domain: contracts, worker handlers, and composition. The islands layer
        is separate: it moves the whole render tree into a worker — see{' '}
        <a href="#/islands">Islands</a> for when that's the right trade.
      </p>
    </article>
  );
}
