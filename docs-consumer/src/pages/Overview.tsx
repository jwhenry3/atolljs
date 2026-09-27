import { CodeBlock } from '../components/CodeBlock';

const DIAGRAM = `main thread                                    worker(s)
┌─────────────────────────────┐   postMessage   ┌──────────────────────────┐
│ WorkerPool                  │ ─── task ─────▶ │ TaskRegistry handlers    │
│   pool.query(args)          │ ◀── result ──── │   scan / sort / mutate   │
│                             │                 │        │                 │
│ connector reads / watches   │                 │        ▼                 │
└──────────────┬──────────────┘                 └──────────┬───────────────┘
               │               SharedArrayBuffer           │
               ▼        (same bytes, zero copy)            ▼
        ┌─────────────────────────────────────────────────────────┐
        │  contract: struct rows · strings · objects · numbers    │
        └─────────────────────────────────────────────────────────┘`;

export function Overview() {
  return (
    <article>
      <h1>mesh — the Worker Mesh</h1>
      <p className="lead">
        A worker mesh: pools and shared workers joined to your app through one
        shared-memory fabric. Threads share a fixed-layout{' '}
        <code>SharedArrayBuffer</code> contract; work is offloaded two ways —
        task <em>commands</em> (dispatch → result) and <em>state reactivity</em>{' '}
        (field changes drive behavior) — a fluid model that would deadlock or
        serialize in a single-threaded app.
      </p>

      <h2>Install</h2>
      <CodeBlock code={`npm install @jwhenry123/mesh`} language="bash" />
      <p>
        The core package ships the SDK — imported as{' '}
        <code>@jwhenry123/mesh/sdk</code>. Framework bindings are separate,
        independently published packages — <code>@jwhenry123/mesh-&lt;framework&gt;</code> —
        so you only install the framework you actually use.
      </p>

      <h2>How it fits together</h2>
      <CodeBlock code={DIAGRAM} language="plaintext" />
      <p>
        Three layers: <strong>contracts</strong> (<code>defineSharedMemory</code>{' '}
        + <code>field.*</code>) declare the memory layout once for both threads;
        the <strong>pool</strong> (<code>WorkerPool</code> +{' '}
        <code>TaskRegistry</code> + worker bootstrap) dispatches typed tasks;{' '}
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
            <td><code>@jwhenry123/mesh/sdk</code></td>
            <td>Shared-memory contracts, worker pool, worker bootstrap, observables, tasks, codecs, logging</td>
          </tr>
          <tr>
            <td><code>@jwhenry123/mesh-react</code></td>
            <td><code>useObservable</code>, <code>useSharedValue</code>, <code>useTask</code> — React hooks</td>
          </tr>
          <tr>
            <td><code>@jwhenry123/mesh-vue</code></td>
            <td><code>useObservable</code>, <code>useSharedValue</code>, <code>useTask</code> — Ref-producing composables</td>
          </tr>
          <tr>
            <td><code>@jwhenry123/mesh-solidjs</code></td>
            <td><code>createObservable</code>, <code>createSharedValue</code>, <code>createTask</code> — Accessors</td>
          </tr>
          <tr>
            <td><code>@jwhenry123/mesh-svelte</code></td>
            <td><code>observableValue</code>, <code>sharedValue</code>, <code>taskState</code> — rune-backed state</td>
          </tr>
          <tr>
            <td><code>@jwhenry123/mesh-angular</code></td>
            <td><code>observableSignal</code>, <code>sharedValue</code>, <code>taskState</code> — Signals</td>
          </tr>
          <tr>
            <td><code>@jwhenry123/mesh-nextjs</code></td>
            <td>Re-exports the React binding — App Router safe, SSR-ready</td>
          </tr>
        </tbody>
      </table>
      <p>
        Bindings contain zero domain code — they adapt the SDK's observable
        primitives to each framework's reactivity model. Your app owns the
        domain: contracts, worker handlers, and composition.
      </p>
    </article>
  );
}
