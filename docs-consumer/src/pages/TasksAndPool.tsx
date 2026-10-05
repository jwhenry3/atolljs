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
        parameters, and validation happens inside the worker: the trust boundary
        is the message.
      </p>
      <CodeBlock
        file="service/queryIncidents.ts"
        code={`import { serviceMethod } from '@atolljs/core';
import { z } from 'zod';

export const queryIncidents = serviceMethod({
  def: { argsSchema: z.tuple([queryArgsSchema]), resultSchema: queryResultSchema },
  run(q) {                       // q: QueryArgs: inferred from the schema
    // scan/sort shared list rows in place, return only the visible page
    return runQuery(q);
  },
});`}
      />

      <h2>Worker side: defineWorker owns the method list</h2>
      <CodeBlock
        file="incidents.worker.ts"
        code={`import { defineWorker } from '@atolljs/core';
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

      <h2>Main thread: connectWorker, type-only import</h2>
      <CodeBlock
        file="incidents.ts"
        code={`import { connectWorker } from '@atolljs/core';
import { incidentsMemory } from './incidents.memory';
import type { IncidentsWorker } from './incidents.worker';   // zero worker code in this bundle

export const incidents = connectWorker<IncidentsWorker>({
  sharedMemory: incidentsMemory,
  worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url), { type: 'module' }),
  workers: 'auto',             // 'auto' = navigator.hardwareConcurrency ?? 4; default 1
});

// A Proxy typed by the worker's signatures: pool spawns on first call:
const page = await incidents.queryIncidents({ offset: 0, limit: 50 });
incidents.terminate();         // next call re-spawns

// Already hold a pool (e.g. Nest's @InjectAtollPool)? Wrap it directly:
import { workerClient } from '@atolljs/core';
const api = workerClient<IncidentsWorker>(pool);`}
      />

      <h2>connectWorker config</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Option</th><th>Meaning</th></tr>
        </thead>
        <tbody>
          <tr><td><code>worker</code></td><td>Factory <code>() =&gt; new Worker(new URL(...))</code>: required for esbuild/webpack/turbopack to detect the entry. A <code>URL</code> also works where the bundler emits one (Vite).</td></tr>
          <tr><td><code>sharedMemory</code></td><td><em>Optional.</em> A contract to bind on the main thread and ship to workers: type-checked against the worker's declaration. Omit for a message-only pool: no <code>SharedArrayBuffer</code>, no COOP/COEP headers required.</td></tr>
          <tr><td><code>workers</code></td><td>How many workers you need: a number (default <code>1</code>), or <code>'auto'</code> for <code>navigator.hardwareConcurrency ?? 4</code>. <code>1</code> is one dedicated worker with no pool; more builds a <code>WorkerPool</code>.</td></tr>
          <tr><td><code>poolSize</code></td><td><em>Deprecated</em> alias for <code>workers</code>.</td></tr>
          <tr><td><code>concurrency</code></td><td><em>Pool only.</em> Max in-flight calls per worker (default 1). Dispatch is least-busy; when every worker is at the cap, calls queue FIFO.</td></tr>
          <tr><td><code>maxQueue</code></td><td><em>Pool only.</em> Queue bound (default unbounded). A full queue rejects immediately with <code>PoolQueueFullError</code>: backpressure instead of unbounded growth.</td></tr>
          <tr><td><code>taskTimeout</code></td><td>Default per-call timeout in ms, measured from enqueue (queue wait + run). Rejects with <code>TaskTimeoutError</code>.</td></tr>
          <tr><td><code>respawn</code></td><td>Default <code>true</code>: a crashed worker is replaced and its in-flight calls reject with <code>WorkerCrashedError</code>. <code>false</code> shrinks the pool instead.</td></tr>
          <tr><td><code>memory</code></td><td>Buffer growth: <code>maximumPages</code> (default 16384 = 1 GB), <code>growthFactor</code>.</td></tr>
          <tr><td><code>lazy</code></td><td>Default <code>true</code>: spawn on first call (SSR-safe import). <code>false</code> spawns at construction.</td></tr>
        </tbody>
      </table>

      <h2>How many workers</h2>
      <p>
        <code>workers</code> states intent; the client picks the machinery.{' '}
        <code>workers: 1</code> (the default) is a <code>DedicatedWorker</code>:
        calls post straight to the worker, with no queue and no scheduler, and
        it keeps per-call timeout and abort, crash respawn,{' '}
        <code>stats()</code> and the devtools events. <code>workers: N</code>{' '}
        or <code>'auto'</code> builds a <code>WorkerPool</code> that spreads
        separate calls across N workers; one call still runs on one worker.
      </p>
      <ul>
        <li>
          <strong>Use more than one</strong> when independent heavy calls
          should overlap (N jobs on N workers finish in about the time of
          one), or for throughput under load, where the pool is the
          backpressure point.
        </li>
        <li>
          <strong>Use one</strong> when state lives in the worker (a cache, a
          loaded model, a rendered island tree) so every call must land on the
          same worker, or when you only need the work <em>off the main
          thread</em>. Island clients are always one worker.
        </li>
      </ul>

      <h2>Cancellation, timeouts, backpressure</h2>
      <CodeBlock
        code={`// Per-call controls ride on .with(), the same typed surface
const ctrl = new AbortController();
const page = incidents.with({ signal: ctrl.signal, timeout: 2_000 }).queryIncidents(q);
ctrl.abort();   // rejects with TaskAbortedError, queued → dropped;
                // in-flight → rejects now, the worker's late reply is discarded

// Observe the pool
incidents.pool?.stats();
// { workers, idle, inFlight, queued, completed, failed, aborted,
//   waitMs: { count, mean, max }, runMs: { count, mean, max } }

await incidents.pool?.close();   // drain the queue, then terminate`}
      />
      <p>
        A <code>signal</code> abort rejects with <code>TaskAbortedError</code>{' '}
        (exported from <code>@atolljs/core</code>, alongside{' '}
        <code>PoolQueueFullError</code>, <code>TaskTimeoutError</code>, and{' '}
        <code>WorkerCrashedError</code>). JavaScript can't interrupt a running
        function, so an in-flight abort rejects the caller and holds the worker's
        slot until its reply arrives: the next call goes to a genuinely free
        worker. For a hard stop, call <code>terminate()</code>.
      </p>

      <p>
        Client members <code>start()</code>, <code>terminate()</code>,{' '}
        <code>with()</code>, <code>pool</code>, <code>sharedMemory</code> are
        reserved: a worker method by those names is a compile error. Under the
        hood <code>connectWorker</code> builds a <code>DedicatedWorker</code>{' '}
        (one worker) or a <code>WorkerPool</code> (more than one); the
        explicit-contract API (<code>TaskContract</code> +{' '}
        <code>TaskRegistry.register</code> + <code>WorkerPool</code>'s{' '}
        <code>tasks</code>) remains available when both threads need the contract
        object at runtime.
      </p>

      <h2>Explicit service contracts (advanced)</h2>
      <p>
        <code>defineWorker</code>/<code>connectWorker</code> build on a lower,
        framework-neutral layer: the same one the NestJS binding dispatches
        through. Reach for it when both threads need the contract object at
        runtime (a hand-built <code>WorkerPool</code>, a DI provider, a test
        stub):
      </p>
      <table className="doc-table">
        <thead>
          <tr><th>Export</th><th>What it does</th></tr>
        </thead>
        <tbody>
          <tr><td><code>defineService(name, methods)</code></td><td>Declares the contract bundle once: <code>{'{ method: { argsSchema?, resultSchema? } }'}</code>. Wire ids derive as <code>service.method</code>; signatures infer from the schemas (<code>argsSchema: z.tuple(...)</code> → args, <code>resultSchema</code> → return type).</td></tr>
          <tr><td><code>implementService(service, handlers)</code></td><td>Worker-side registration; throws at bind time on a missing method.</td></tr>
          <tr><td><code>createClient(service, runner)</code></td><td>Typed proxy over any <code>TaskRunner</code>: a pool, a SharedWorker client, or a test stub.</td></tr>
          <tr><td><code>service.tasks</code></td><td>A <code>TaskMap</code> you can feed straight to <code>new WorkerPool({'{ tasks }'})</code>.</td></tr>
          <tr><td><code>rpc&lt;A, R&gt;({'{ taskId? }'})</code></td><td>Escape hatch for schema-less methods or explicit wire ids.</td></tr>
        </tbody>
      </table>

      <h2>defineTask: latest-wins runners</h2>
      <p>
        <code>defineTask(fn)</code> wraps an async call into an{' '}
        <code>AsyncTask</code>: latest-wins (stale results dropped), plus an
        observable snapshot <code>{'{ data, pending, settled, elapsedMs, error }'}</code>{' '}
        the framework bindings render. <code>runOnce()</code> makes init-style
        tasks remount/StrictMode-safe.
      </p>
      <CodeBlock
        code={`// Bindings accept any async function and wrap it per call site:
const page = useTask(incidents.queryIncidents);     // React: taskState() in Angular/Svelte
page.run({ offset: 0, limit: 50 });                  // latest-wins
page.data; page.pending; page.elapsedMs;

// The primitive underneath, if you need it outside a framework:
import { defineTask } from '@atolljs/core';
const queryTask = defineTask((q: QueryArgs) => incidents.queryIncidents(q));
queryTask.subscribe((snap) => render(snap));`}
      />

      <h2>Node workers</h2>
      <p>
        <code>WorkerPool</code>/<code>connectWorker</code> run on{' '}
        <code>node:worker_threads</code> unchanged :{' '}
        <code>@atolljs/node</code> adapts Node's <code>Worker</code> to
        the DOM surface the pool expects.{' '}
        <code>createNodePool({'{ workerFile | worker | createWorker, … }'})</code>{' '}
        is <code>WorkerPool</code> with the adapter baked in; its{' '}
        <code>worker:</code> factory may return a{' '}
        <code>node:worker_threads.Worker</code> directly (adapted internally),
        which keeps the bundler-detectable{' '}
        <code>new Worker(new URL('./x.worker.ts', import.meta.url))</code>{' '}
        literal usable on Node. For <code>connectWorker</code> or{' '}
        <code>new WorkerPool</code> directly, wrap the spawn yourself with{' '}
        <code>createNodeWorker</code>.
      </p>
      <p>
        A Node worker entry imports <code>@atolljs/node/shim</code>{' '}
        first: it binds <code>self = parentPort</code> before{' '}
        <code>defineWorker</code>'s bootstrap evaluates.{' '}
        <code>SharedArrayBuffer</code> works in Node with no headers: isolation
        is a browser-only requirement.
      </p>
    </article>
  );
}
