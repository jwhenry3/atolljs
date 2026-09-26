import { CodeBlock } from '../components/CodeBlock';
import clientSource from '../../../src/sdk/shared/sharedWorkerClient.ts?raw';
import hostSource from '../../../src/sdk/shared/sharedWorkerHost.ts?raw';

export function SharedWorker() {
  return (
    <article>
      <h1>Shared worker</h1>
      <p className="lead">
        <code>connectSharedWorker</code> + <code>sharedWorkerHost</code> extend
        the shared-memory pattern beyond a single page: one{' '}
        <code>SharedWorker</code> owns one <code>SharedArrayBuffer</code>, and
        every page, tab, and iframe that connects binds its contract to that
        same buffer. The point isn't messaging between contexts — it's shared
        state.
      </p>

      <h2>Pool vs shared worker</h2>
      <table className="doc-table">
        <thead>
          <tr><th></th><th><code>WorkerPool</code></th><th><code>connectSharedWorker</code></th></tr>
        </thead>
        <tbody>
          <tr><td>Worker kind</td><td>N dedicated <code>Worker</code>s, owned by one page</td><td>One <code>SharedWorker</code>, shared across contexts</td></tr>
          <tr><td>Buffer owner</td><td>Page allocates, pushes to workers</td><td>Worker allocates once, shares with every client</td></tr>
          <tr><td>Memory scope</td><td>Per page</td><td><strong>Cross-tab / cross-iframe</strong> — one buffer, every client binds it</td></tr>
          <tr><td>State propagation</td><td>Field writes → <code>observe</code> within the page</td><td>Field writes → <code>observe</code> in <em>every connected context</em></td></tr>
          <tr><td>Task dispatch</td><td>Round-robin across workers</td><td>Per-client port; single worker serializes execution</td></tr>
          <tr><td>Lifecycle</td><td><code>terminate()</code> kills workers</td><td><code>disconnect()</code> closes this port; browser owns the worker</td></tr>
        </tbody>
      </table>

      <h2>State propagates through memory, not messages</h2>
      <p>
        Every field write bumps a shared version counter via{' '}
        <code>Atomics.add</code> + <code>Atomics.notify</code>, and each client's{' '}
        <code>observe</code>/<code>watch</code> subscribers park on{' '}
        <code>Atomics.waitAsync</code> over that same counter. Because the buffer
        is literally shared, a write in one tab resolves every other tab's
        waiter — <strong>zero <code>postMessage</code>, zero serialization, the
        worker isn't even involved</strong>.
      </p>
      <CodeBlock
        code={`// tab A
memory.metrics.write((m) => ({ ...m, critical: m.critical + 1 }));

// tab B — fires on tab A's write. No message ever crossed the port.
observe(memory, 'metrics').subscribe((m) => render(m));`}
      />
      <p>
        Port messages are only the <em>control plane</em> — the connect
        handshake and task dispatch (request → compute → reply). State itself
        never crosses a port; it lives in the buffer everyone shares.
      </p>

      <h2>Protocol (control plane only)</h2>
      <p>
        Each connection is an independent <code>MessagePort</code> from{' '}
        <code>onconnect</code>. The handshake inverts the pool's{' '}
        <code>INIT_MEMORY</code>: the client declares its contract's{' '}
        <code>memoryBytes</code>, the host lazily allocates a shared{' '}
        <code>WebAssembly.Memory</code> and returns the buffer — first client's
        capacity wins. After that, ports only carry task dispatch.
      </p>
      <CodeBlock
        code={`client → host   { type: 'SHARED_CONNECT', memoryBytes, memory? }
host   → client { type: 'SHARED_MEMORY',  buffer, clientIndex }
client → host   { type: 'EXECUTE_TASK',   messageId, taskId, args }
host   → client { messageId, success, result | error }
client → host   { type: 'SHARED_DISCONNECT' }`}
        language="plaintext"
      />
      <p>
        Task execution reuses <code>TaskRegistry</code> verbatim — args/result
        schema validation and error replies are identical to the pool path.
      </p>

      <h2>Host — worker entry</h2>
      <CodeBlock
        code={`import { sharedWorkerHost } from '@jwhenry123/mesh/sdk';
import './task.handlers';   // TaskRegistry.register(...) calls
sharedWorkerHost();         // installs onconnect → attachSharedPort(port)`}
      />
      <CodeBlock code={hostSource} file="src/sdk/shared/sharedWorkerHost.ts" />

      <h2>Client — page side</h2>
      <CodeBlock
        code={`import { connectSharedWorker } from '@jwhenry123/mesh/sdk';

const worker = await connectSharedWorker({
  createWorker: () => new SharedWorker(
    new URL('./incidents.sharedWorker.ts', import.meta.url),
    { type: 'module' }
  ),
  sharedMemory: incidentsMemory,
  tasks: { initIncidents: InitIncidents, queryIncidents: QueryIncidents },
});

await worker.queryIncidents({ offset: 0, limit: 50 });  // typed method
worker.sharedMemory.metrics.read();                     // same buffer as every other client
worker.disconnect();                                    // this client only — worker stays up`}
      />
      <CodeBlock code={clientSource} file="src/sdk/shared/sharedWorkerClient.ts" />

      <h2>Notes</h2>
      <ul>
        <li>
          <strong>Reactivity is unchanged</strong> — once the contract binds,
          <code>observe</code>/<code>watch</code>/framework bindings work the
          same; the buffer is just physically shared across contexts now.
        </li>
        <li>
          <strong>Safari has no SharedWorker</strong> — feature-detect and fall
          back to <code>WorkerPool</code>.
        </li>
        <li>
          <strong>Same COOP/COEP requirements</strong> — it's still
          SharedArrayBuffer. Iframed clients additionally need the full
          embedding chain from <a href="#/isolation">Cross-origin isolation</a>.
        </li>
        <li>
          <strong>Concurrency</strong> — one worker serializes task execution.
          No broadcast is needed for state: writes reach every client through
          the shared buffer, not through messages.
        </li>
      </ul>
    </article>
  );
}
