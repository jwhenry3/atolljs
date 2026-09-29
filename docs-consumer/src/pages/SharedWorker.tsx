import { CodeBlock } from '../components/CodeBlock';

export function SharedWorker() {
  return (
    <article>
      <h1>Shared worker</h1>
      <p className="lead">
        <code>@atolljs/core</code> ships a <code>SharedWorker</code>-based
        runtime alongside <code>WorkerPool</code>. Its purpose is{' '}
        <strong>shared state</strong>, not messaging: one worker owns one{' '}
        <code>SharedArrayBuffer</code>, and every page, tab, and iframe that
        connects binds its contract to that same buffer — writes in one are
        readable and observable in all.
      </p>

      <CodeBlock code={`npm install @atolljs/core`} language="bash" />

      <h2>Worker entry</h2>
      <CodeBlock
        file="src/incidents.sharedWorker.ts"
        code={`import { sharedWorkerHost, TaskRegistry } from '@atolljs/core';
import { incidentsMemory } from './memory';
import { getIncidents, queryIncidents } from './queries';

TaskRegistry.register(InitIncidents, async () => seed(incidentsMemory));
TaskRegistry.register(QueryIncidents, (q) => queryIncidents(incidentsMemory, q));
sharedWorkerHost();`}
      />

      <h2>Client</h2>
      <CodeBlock
        file="main thread / any page, tab, or iframe"
        code={`import { connectSharedWorker } from '@atolljs/core';
import { incidentsMemory, InitIncidents, QueryIncidents } from './contracts';

const worker = await connectSharedWorker({
  // Inline new SharedWorker(new URL(...)) so your bundler emits the chunk.
  createWorker: () => new SharedWorker(
    new URL('./incidents.sharedWorker.ts', import.meta.url),
    { type: 'module' }
  ),
  sharedMemory: incidentsMemory,
  tasks: { initIncidents: InitIncidents, queryIncidents: QueryIncidents },
});

await worker.initIncidents();                          // first-class task method
const page = await worker.queryIncidents({ offset: 0, limit: 50 });
worker.sharedMemory.metrics.read();                    // shared across ALL clients
worker.disconnect();                                   // close this port only`}
      />

      <h2>Config</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Option</th><th>Type</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td><code>workerUrl</code></td><td><code>URL</code></td><td>Worker entry URL — one of the three connect options is required</td></tr>
          <tr><td><code>createWorker</code></td><td><code>() =&gt; SharedWorker</code></td><td>Preferred — bundlers only emit the chunk when <code>new SharedWorker(new URL(...))</code> appears inline</td></tr>
          <tr><td><code>port</code></td><td><code>MessagePort</code></td><td>Pre-opened port — tests or custom plumbing</td></tr>
          <tr><td><code>sharedMemory</code></td><td><code>SharedMemory</code></td><td>Contract; bound to the worker's buffer on connect</td></tr>
          <tr><td><code>memory</code></td><td><code>MemoryConfig</code></td><td>Buffer sizing hint — <em>first connected client wins</em>; later clients share that buffer</td></tr>
          <tr><td><code>tasks</code></td><td><code>TaskMap</code></td><td>Named contracts → first-class methods</td></tr>
          <tr><td><code>connectTimeoutMs</code></td><td><code>number</code></td><td>Handshake timeout, default 10s</td></tr>
        </tbody>
      </table>

      <h2>Client surface</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Member</th><th>Behavior</th></tr>
        </thead>
        <tbody>
          <tr><td><code>runTask(contract, ...args)</code></td><td>Compute dispatch; resolves with the validated result for this client</td></tr>
          <tr><td><code>clientIndex</code></td><td>Connection order reported by the host</td></tr>
          <tr><td><code>sharedMemory</code></td><td>The bound contract — <code>observe()</code> and framework bindings work unchanged</td></tr>
          <tr><td><code>disconnect()</code></td><td>Closes this port; the worker and buffer live on for other clients</td></tr>
        </tbody>
      </table>

      <h2>State propagates through memory, not messages</h2>
      <p>
        Cross-context sync needs no messaging at all: every write bumps a shared
        version counter (<code>Atomics.add</code> + <code>notify</code>), and
        each client's <code>observe()</code>/<code>watch()</code> subscribers
        wait on that counter (<code>Atomics.waitAsync</code>). A write in one
        tab resolves every other tab's observer directly — the port only carries
        the connect handshake and task dispatch.
      </p>
      <CodeBlock
        code={`// tab A writes
memory.metrics.write((m) => ({ ...m, critical: m.critical + 1 }));

// tab B observes — fires on tab A's write, no postMessage involved
observe(memory, 'metrics').subscribe(render);`}
      />

      <h2>Pool or shared worker?</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Use…</th><th>When</th></tr>
        </thead>
        <tbody>
          <tr><td><code>WorkerPool</code></td><td>CPU parallelism in one page; per-page private memory</td></tr>
          <tr><td><code>connectSharedWorker</code></td><td>One shared dataset across tabs/iframes — state syncs through memory</td></tr>
        </tbody>
      </table>

      <h2>Caveats</h2>
      <ul>
        <li>
          <strong>Safari dropped SharedWorker.</strong> Feature-detect and fall
          back to a per-page <code>WorkerPool</code>:
          <code>{`typeof SharedWorker === 'undefined'`}</code>.
        </li>
        <li>
          <strong>Same cross-origin isolation rules</strong> — it's still
          SharedArrayBuffer; see <a href="#/hosting">Hosting &amp; headers</a>.
          Iframed clients need the full embedding chain there.
        </li>
        <li>
          <strong>One worker, serialized work</strong> — a SharedWorker is a
          single thread. State sync costs nothing (it's just shared memory),
          but task execution is one-at-a-time; use WorkerPool for CPU parallelism.
        </li>
        <li>
          <strong>No <code>terminate()</code></strong> — the browser owns the
          worker lifecycle; clients only disconnect.
        </li>
      </ul>
    </article>
  );
}
