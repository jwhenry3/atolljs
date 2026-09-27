import { CodeBlock } from '../components/CodeBlock';

export function TasksAndPool() {
  return (
    <article>
      <h1>Worker pool &amp; tasks</h1>
      <p className="lead">
        Tasks cross the thread boundary via <code>postMessage</code>; the data
        they touch stays in shared memory.
      </p>

      <h2>One method, one file</h2>
      <p>
        A <code>serviceMethod</code> unit holds a method's wire schemas and its
        worker implementation together. The schemas type <code>run</code>'s
        parameters, and validation happens inside the worker — the trust boundary
        is the message.
      </p>
      <CodeBlock
        file="service/queryIncidents.ts"
        code={`import { serviceMethod } from '@jwhenry123/mesh/sdk';
import { z } from 'zod';

export const queryIncidents = serviceMethod({
  def: { argsSchema: z.tuple([queryArgsSchema]), resultSchema: queryResultSchema },
  run(q) {                       // q: QueryArgs — inferred from the schema
    // scan/sort shared list rows in place, return only the visible page
    return runQuery(q);
  },
});`}
      />

      <h2>Worker side — defineWorker owns the method list</h2>
      <CodeBlock
        file="incidents.worker.ts"
        code={`import { defineWorker } from '@jwhenry123/mesh/sdk';
import { incidentsMemory } from './incidents.memory';
import { queryIncidents } from './service/queryIncidents';

// Wires INIT_MEMORY / EXECUTE_TASK and registers each method under its name.
export const incidentsWorker = defineWorker({
  sharedMemory: incidentsMemory,
  methods: { queryIncidents, ping: () => 'pong' },   // units or plain functions
  // services: { pricing: { reprice } }  → client.pricing.reprice(), taskId "pricing.reprice"
});
export type IncidentsWorker = typeof incidentsWorker;   // all main ever imports`}
      />

      <h2>Main thread — connectWorker, type-only import</h2>
      <CodeBlock
        file="incidents.ts"
        code={`import { connectWorker } from '@jwhenry123/mesh/sdk';
import { incidentsMemory } from './incidents.memory';
import type { IncidentsWorker } from './incidents.worker';   // zero worker code in this bundle

export const incidents = connectWorker<IncidentsWorker>({
  sharedMemory: incidentsMemory,
  worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url), { type: 'module' }),
  poolSize: 'auto',            // 'auto' = navigator.hardwareConcurrency ?? 4
});

// A Proxy typed by the worker's signatures — pool spawns on first call:
const page = await incidents.queryIncidents({ offset: 0, limit: 50 });
incidents.terminate();         // next call re-spawns

// Already hold a pool (e.g. Nest's @InjectMeshPool)? Wrap it directly:
import { workerClient } from '@jwhenry123/mesh/sdk';
const api = workerClient<IncidentsWorker>(pool);`}
      />

      <h2>connectWorker config</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Option</th><th>Meaning</th></tr>
        </thead>
        <tbody>
          <tr><td><code>worker</code></td><td>Factory <code>() =&gt; new Worker(new URL(...))</code> — required for esbuild/webpack/turbopack to detect the entry. A <code>URL</code> also works where the bundler emits one (Vite).</td></tr>
          <tr><td><code>sharedMemory</code></td><td><em>Optional.</em> A contract to bind on the main thread and ship to workers — type-checked against the worker's declaration. Omit for a message-only pool: no <code>SharedArrayBuffer</code>, no COOP/COEP headers required.</td></tr>
          <tr><td><code>poolSize</code></td><td>A number, or <code>'auto'</code> (default) for <code>navigator.hardwareConcurrency ?? 4</code>.</td></tr>
          <tr><td><code>concurrency</code></td><td>Max in-flight calls per worker (default 1). Dispatch is least-busy; when every worker is at the cap, calls queue FIFO.</td></tr>
          <tr><td><code>maxQueue</code></td><td>Queue bound (default unbounded). A full queue rejects immediately with <code>PoolQueueFullError</code> — backpressure instead of unbounded growth.</td></tr>
          <tr><td><code>taskTimeout</code></td><td>Default per-call timeout in ms, measured from enqueue (queue wait + run). Rejects with <code>TaskTimeoutError</code>.</td></tr>
          <tr><td><code>respawn</code></td><td>Default <code>true</code> — a crashed worker is replaced and its in-flight calls reject with <code>WorkerCrashedError</code>. <code>false</code> shrinks the pool instead.</td></tr>
          <tr><td><code>memory</code></td><td>Buffer growth: <code>maximumPages</code> (default 16384 = 1 GB), <code>growthFactor</code>.</td></tr>
          <tr><td><code>lazy</code></td><td>Default <code>true</code> — spawn on first call (SSR-safe import). <code>false</code> spawns at construction.</td></tr>
        </tbody>
      </table>

      <h2>Cancellation, timeouts, backpressure</h2>
      <CodeBlock
        code={`// Per-call controls ride on .with() — the same typed surface
const ctrl = new AbortController();
const page = incidents.with({ signal: ctrl.signal, timeout: 2_000 }).queryIncidents(q);
ctrl.abort();   // queued → dropped; in-flight → rejects now, the worker's late reply is discarded

// Observe the pool
incidents.pool?.stats();
// { workers, idle, inFlight, queued, completed, failed, aborted,
//   waitMs: { count, mean, max }, runMs: { count, mean, max } }

await incidents.pool?.close();   // drain the queue, then terminate`}
      />
      <p>
        JavaScript can't interrupt a running function, so an in-flight abort
        rejects the caller and holds the worker's slot until its reply arrives —
        the next call goes to a genuinely free worker. For a hard stop, call{' '}
        <code>terminate()</code>.
      </p>

      <p>
        Client members <code>start()</code>, <code>terminate()</code>,{' '}
        <code>with()</code>, <code>pool</code>, <code>sharedMemory</code> are
        reserved — a worker method by those names is a compile error. Under the
        hood <code>connectWorker</code> builds a <code>WorkerPool</code>; the
        explicit-contract API (<code>TaskContract</code> +{' '}
        <code>TaskRegistry.register</code> + <code>WorkerPool</code>'s{' '}
        <code>tasks</code>) remains available when both threads need the contract
        object at runtime.
      </p>

      <h2>defineTask — latest-wins runners</h2>
      <p>
        <code>defineTask(fn)</code> wraps an async call into an{' '}
        <code>AsyncTask</code>: latest-wins (stale results dropped), plus an
        observable snapshot <code>{'{ data, pending, settled, elapsedMs, error }'}</code>{' '}
        the framework bindings render. <code>runOnce()</code> makes init-style
        tasks remount/StrictMode-safe.
      </p>
      <CodeBlock
        code={`// Bindings accept any async function and wrap it per call site:
const page = useTask(incidents.queryIncidents);     // React — taskState() in Angular/Svelte
page.run({ offset: 0, limit: 50 });                  // latest-wins
page.data; page.pending; page.elapsedMs;

// The primitive underneath, if you need it outside a framework:
import { defineTask } from '@jwhenry123/mesh/sdk';
const queryTask = defineTask((q: QueryArgs) => incidents.queryIncidents(q));
queryTask.subscribe((snap) => render(snap));`}
      />
    </article>
  );
}
