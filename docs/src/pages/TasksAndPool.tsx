import { CodeBlock } from '../components/CodeBlock';
import taskFile from '../../../packages/incidents/src/service/queryIncidents.ts?raw';
import workerSource from '../../../packages/incidents/src/worker/incidents.worker.ts?raw';
import clientSource from '../../../packages/incidents/src/incidents.ts?raw';

export function TasksAndPool() {
  return (
    <article>
      <h1>Worker pool &amp; tasks</h1>
      <p className="lead">
        Tasks are the only message-passing boundary, and they're split the way
        tRPC splits a router: the <em>worker script</em> owns the runtime and the
        method list via <code>defineWorker</code>; the main thread imports only
        its <code>typeof</code> and drives it through a <code>connectWorker</code>{' '}
        Proxy client. Method names are listed exactly once.
      </p>

      <h2>One file per method</h2>
      <p>
        Each task owns one file under <code>service/</code> containing its wire
        schemas and its worker implementation as a <code>serviceMethod</code> unit.
        The schemas type <code>run</code>'s parameters — nothing to annotate:
      </p>
      <CodeBlock code={taskFile} file="packages/incidents/src/service/queryIncidents.ts" />
      <p>
        <code>argsSchema</code>/<code>resultSchema</code> validate at the thread
        boundary inside the worker — the trust boundary is the message. Plain
        functions work too (<code>methods: {'{ ping: () => "pong" }'}</code>) when
        no validation is needed; their signature types the client directly.
      </p>

      <h2>Worker side — the whole entry</h2>
      <CodeBlock code={workerSource} file="packages/incidents/src/worker/incidents.worker.ts" />
      <p>
        <code>defineWorker</code> installs the message loop (binds shared memory on{' '}
        <code>INIT_MEMORY</code>, dispatches <code>EXECUTE_TASK</code>) and registers
        every method under its own name. <code>services: {'{ pricing: { … } }'}</code>{' '}
        namespaces methods as <code>pricing.reprice</code> when one worker hosts
        several domains. The exported <code>IncidentsWorker</code> type is all the
        main thread ever imports from this file.
      </p>

      <h2>Main thread — the client</h2>
      <CodeBlock code={clientSource} file="packages/incidents/src/incidents.ts" />
      <p>
        <code>import type</code> keeps worker code out of the main bundle. The
        client is a Proxy: <code>incidents.queryIncidents(q)</code> dispatches{' '}
        <code>taskId "queryIncidents"</code> to the pool — typed by the worker's
        method signatures. The pool spawns lazily on the first call, so importing
        the client is SSR-safe; <code>start()</code> spawns eagerly,{' '}
        <code>terminate()</code> drops the pool and the next call re-spawns.
      </p>

      <h3>connectWorker config</h3>
      <table className="doc-table">
        <thead>
          <tr><th>Option</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td><code>worker</code></td><td>Factory <code>() =&gt; new Worker(new URL(..., import.meta.url), {'{ type: "module" }'})</code> — bundlers only emit worker chunks for the inline form. A <code>URL</code> also works.</td></tr>
          <tr><td><code>sharedMemory</code></td><td><em>Optional.</em> The contract to bind on the main thread and ship to workers, type-checked against the worker's declared <code>sharedMemory</code>. Omit for a message-only pool — no <code>SharedArrayBuffer</code> or COOP/COEP requirement; the handshake becomes a bare <code>INIT</code>.</td></tr>
          <tr><td><code>poolSize</code></td><td>A number, or <code>'auto'</code> (default) for <code>navigator.hardwareConcurrency ?? 4</code>.</td></tr>
          <tr><td><code>concurrency</code></td><td>In-flight cap per worker (default 1); least-busy dispatch, FIFO queue beyond the cap.</td></tr>
          <tr><td><code>maxQueue</code></td><td>Queue bound; a full queue rejects with <code>PoolQueueFullError</code>.</td></tr>
          <tr><td><code>taskTimeout</code></td><td>Default timeout from enqueue (queue wait + run) → <code>TaskTimeoutError</code>. Override per call via <code>client.with({'{ timeout }'})</code>.</td></tr>
          <tr><td><code>respawn</code></td><td>Default <code>true</code>: crashed workers are replaced; in-flight calls reject with <code>WorkerCrashedError</code>.</td></tr>
          <tr><td><code>lazy</code></td><td>Default <code>true</code>. <code>false</code> spawns at construction.</td></tr>
        </tbody>
      </table>
      <p>
        <code>client.with({'{ signal, timeout }'})</code> returns the same typed
        surface with per-call controls; <code>pool.stats()</code> exposes
        queue/in-flight counts and wait/run aggregates; <code>pool.close()</code>{' '}
        drains then terminates. A <code>signal</code> abort rejects the call with{' '}
        <code>TaskAbortedError</code> (all four errors are exported from{' '}
        <code>@jwhenry123/mesh/sdk</code>): a queued call is dropped, an in-flight
        one rejects the caller but holds the worker's slot until its reply arrives —
        JS can't interrupt a running task, so the pool never double-books a busy
        worker.
      </p>

      <h2>Under the hood</h2>
      <p>
        <code>connectWorker</code> builds a <code>WorkerPool</code>; <code>workerClient(runner)</code>{' '}
        is the bare Proxy over any <code>TaskRunner</code> — a pool you already
        hold (Nest's <code>@InjectMeshPool</code>), a SharedWorker client, or a test
        stub. The explicit-contract path (<code>TaskContract</code>,{' '}
        <code>TaskRegistry.register</code>, <code>defineService</code>) remains for
        cases where both threads need the contract object at runtime.
      </p>

      <h2>Explicit service contracts (advanced)</h2>
      <p>
        <code>defineWorker</code>/<code>connectWorker</code> build on a lower,
        framework-neutral layer (<code>src/sdk/service.ts</code>) — the same one
        the NestJS binding dispatches through. Reach for it when both threads need
        the contract object at runtime — feeding a hand-built{' '}
        <code>WorkerPool</code>, a DI provider, or a test stub:
      </p>
      <table className="doc-table">
        <thead>
          <tr><th>Export</th><th>What it does</th></tr>
        </thead>
        <tbody>
          <tr><td><code>defineService(name, methods)</code></td><td>Declares the contract bundle once — <code>{'{ method: { argsSchema?, resultSchema? } }'}</code>. Wire ids derive as <code>service.method</code>; signatures infer from the schemas (<code>argsSchema: z.tuple(...)</code> → args, <code>resultSchema</code> → return type).</td></tr>
          <tr><td><code>implementService(service, handlers)</code></td><td>Worker-side registration into <code>TaskRegistry</code>; throws at bind time on a missing method instead of surfacing "handler not found" on the far thread.</td></tr>
          <tr><td><code>createClient(service, runner)</code></td><td>The main-thread half — a typed proxy over any <code>TaskRunner</code>: a pool, a SharedWorker client, or a test stub.</td></tr>
          <tr><td><code>service.tasks</code></td><td>A <code>TaskMap</code> — feed it straight to <code>new WorkerPool({'{ tasks }'})</code> or a SharedWorker config.</td></tr>
          <tr><td><code>rpc&lt;A, R&gt;({'{ taskId? }'})</code></td><td>Escape hatch for method declarations schemas can't carry — typed args with no validation, or an explicit wire id for interop.</td></tr>
        </tbody>
      </table>
      <CodeBlock
        code={`import { defineService, implementService, createClient, rpc } from '@jwhenry123/mesh/sdk';

// Both threads import the same object — ids can never drift:
export const pricing = defineService('pricing', {
  reprice: { argsSchema: z.tuple([z.string()]), resultSchema: z.number() },
  ping: rpc<[], string>(),                  // no schemas — types declared
});
// pricing.tasks.reprice.taskId === 'pricing.reprice'

// worker side — a missing method throws here, at bind time:
implementService(pricing, { reprice: (sku) => …, ping: () => 'pong' });

// main thread — over any TaskRunner:
const client = createClient(pricing, pool);
await client.reprice('SKU-1');`}
      />

      <h2>Node workers</h2>
      <p>
        <code>WorkerPool</code>/<code>connectWorker</code> run on{' '}
        <code>node:worker_threads</code> unchanged —{' '}
        <code>@jwhenry123/mesh-node</code> adapts Node's <code>Worker</code> (an
        EventEmitter) to the DOM surface the pool expects. The worker entry's
        first import is <code>@jwhenry123/mesh-node/shim</code>, which binds{' '}
        <code>self = parentPort</code> before <code>defineWorker</code>'s
        bootstrap evaluates.
      </p>
      <CodeBlock
        code={`import { createNodePool, createNodeWorker } from '@jwhenry123/mesh-node';
import { Worker } from 'node:worker_threads';

// createNodePool = new WorkerPool + the adapter baked in. Its worker:
// factory may return a node:worker_threads.Worker directly — adapted
// internally — keeping the bundler-detectable new URL(...) literal:
const pool = createNodePool({
  sharedMemory: memory,
  tasks: pricing.tasks,
  worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
});

// connectWorker / new WorkerPool need the DOM surface — wrap explicitly:
connectWorker<IncidentsWorker>({
  worker: () => createNodeWorker(new Worker('./dist/incidents.worker.js')),
});`}
      />
      <p>
        <code>SharedArrayBuffer</code> works in Node with no headers —
        cross-origin isolation is a browser-only requirement.
      </p>
    </article>
  );
}
