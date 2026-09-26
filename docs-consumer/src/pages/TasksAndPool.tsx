import { CodeBlock } from '../components/CodeBlock';

export function TasksAndPool() {
  return (
    <article>
      <h1>Worker pool &amp; tasks</h1>
      <p className="lead">
        Tasks cross the thread boundary via <code>postMessage</code>; the data
        they touch stays in shared memory.
      </p>

      <h2>TaskContract</h2>
      <p>
        A plain object describing one task: an id plus optional zod schemas that
        validate args and results at the boundary.
      </p>
      <CodeBlock
        code={`import type { TaskContract } from '@jwhenry123/mesh/sdk';
import { z } from 'zod';

export const QueryIncidents: TaskContract<[query: QueryArgs], QueryResult> = {
  taskId: 'inc-query',
  argsSchema: z.tuple([queryArgsSchema]),
  resultSchema: queryResultSchema,
};`}
      />

      <h2>Worker side — register handlers</h2>
      <CodeBlock
        file="incidents.worker.ts"
        code={`import '@jwhenry123/mesh/sdk/worker/workerBootstrap';  // handles INIT_MEMORY / EXECUTE_TASK
import { TaskRegistry } from '@jwhenry123/mesh/sdk';
import { QueryIncidents } from './task.contracts';

// Runs inside the worker; shared fields are already bound when this fires.
TaskRegistry.register(QueryIncidents, (query) => {
  // scan/sort shared struct rows in place, return only the visible page
  return runQuery(query);
});`}
      />

      <h2>Main thread — WorkerPool</h2>
      <CodeBlock
        code={`import { WorkerPool } from '@jwhenry123/mesh/sdk';

const pool = new WorkerPool({
  // Preferred: bundler-detectable worker factory
  createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  // Alternative: workerUrl: new URL('./worker.ts', import.meta.url)
  sharedMemory: incidentsMemory,
  poolSize: 'auto',            // 'auto' = navigator.hardwareConcurrency ?? 4
  tasks: { queryIncidents: QueryIncidents, seedIncidents: SeedIncidents },
});

// Tasks become first-class methods — fully typed:
const page = await pool.queryIncidents({ offset: 0, limit: 50 });`}
      />

      <h2>WorkerPoolConfig</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Option</th><th>Meaning</th></tr>
        </thead>
        <tbody>
          <tr><td><code>workerUrl</code></td><td>Worker entry as URL — works where bundlers emit it (Vite).</td></tr>
          <tr><td><code>createWorker</code></td><td>Factory form — required for esbuild/webpack/turbopack to detect the worker entry.</td></tr>
          <tr><td><code>sharedMemory</code></td><td>The contract to bind on the main thread and ship to workers.</td></tr>
          <tr><td><code>poolSize</code></td><td>A number, or <code>'auto'</code> (default) for <code>navigator.hardwareConcurrency ?? 4</code>.</td></tr>
          <tr><td><code>memory</code></td><td>Buffer growth: <code>maximumPages</code> (default 16384 = 1 GB), <code>growthFactor</code>.</td></tr>
          <tr><td><code>tasks</code></td><td>Named contracts → first-class <code>pool.&lt;name&gt;()</code> methods.</td></tr>
        </tbody>
      </table>

      <h2>defineTask — latest-wins runners</h2>
      <p>
        <code>defineTask(fn)</code> wraps an async call into an{' '}
        <code>AsyncTask</code>: latest-wins (stale results dropped), plus an
        observable snapshot <code>{'{ data, pending, settled, elapsedMs, error }'}</code>{' '}
        the framework bindings render. <code>runOnce()</code> makes init-style
        tasks remount/StrictMode-safe.
      </p>
      <CodeBlock
        code={`import { defineTask } from '@jwhenry123/mesh/sdk';

export const queryTask = defineTask((q: QueryArgs) => pool.queryIncidents(q));

queryTask.run({ offset: 0, limit: 50 });   // latest-wins
queryTask.get();                           // { data, pending, settled, elapsedMs, error }
queryTask.subscribe((snap) => render(snap)); // or let a binding adapt it`}
      />
    </article>
  );
}
