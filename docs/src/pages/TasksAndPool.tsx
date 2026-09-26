import { CodeBlock } from '../components/CodeBlock';
import taskContracts from '../../../packages/incidents/src/contract/task.contracts.ts?raw';
import poolSource from '../../../packages/incidents/src/pool.ts?raw';
import workerSource from '../../../packages/incidents/src/worker/incidents.worker.ts?raw';

export function TasksAndPool() {
  return (
    <article>
      <h1>Worker pool &amp; tasks</h1>
      <p className="lead">
        Tasks are the only message-passing boundary. <code>TaskContract</code>s are
        typed declarations; <code>TaskRegistry</code> implements them in the worker;{' '}
        <code>WorkerPool</code> turns them into first-class promise-returning methods
        on the main thread.
      </p>

      <h2>Task contracts</h2>
      <CodeBlock code={taskContracts} file="packages/incidents/src/contract/task.contracts.ts" />
      <p>
        <code>argsSchema</code>/<code>resultSchema</code> are optional zod validation at
        the thread boundary. The generic signature{' '}
        <code>TaskContract&lt;Args, Result&gt;</code> is what flows into the pool's
        method types.
      </p>

      <h2>Worker side</h2>
      <CodeBlock code={workerSource} file="packages/incidents/src/worker/incidents.worker.ts" />
      <p>
        The <code>@jwhenry123/mesh/sdk/worker/workerBootstrap</code> import installs the
        message loop: it binds shared memory on <code>INIT_MEMORY</code> and dispatches{' '}
        <code>EXECUTE_TASK</code> messages to registered handlers. Handlers read and
        write shared memory directly — results return via <code>postMessage</code>.
      </p>

      <h2>Pool</h2>
      <CodeBlock code={poolSource} file="packages/incidents/src/pool.ts" />

      <h3>WorkerPoolConfig</h3>
      <table className="doc-table">
        <thead>
          <tr><th>Option</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td><code>sharedMemory</code></td><td>The contract to bind on the main thread and ship to workers.</td></tr>
          <tr><td><code>createWorker()</code></td><td>Worker factory. Prefer this — bundlers only emit worker chunks for inline <code>new Worker(new URL(..., import.meta.url))</code>.</td></tr>
          <tr><td><code>workerUrl</code></td><td>Alternative: a prebuilt worker URL (works when the bundler already emits one).</td></tr>
          <tr><td><code>poolSize</code></td><td>A number, or <code>'auto'</code> (default) for <code>navigator.hardwareConcurrency ?? 4</code>.</td></tr>
          <tr><td><code>tasks</code></td><td>Map of named contracts; keys become pool methods: <code>tasks: {'{ queryIncidents }'}</code> → <code>pool.queryIncidents(q)</code>.</td></tr>
        </tbody>
      </table>

      <p>
        Construction binds the contract and posts <code>INIT_MEMORY</code> to each
        worker, so field access is legal the moment the pool exists.
      </p>
    </article>
  );
}
