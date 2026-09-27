import { CodeBlock } from '../components/CodeBlock';

const ARCH = `\
┌─────────────────────────── main thread ───────────────────────────┐
│  framework bindings  →  observe() fields  →  useTask()/run()      │
│         │                                            │            │
│  SharedMemory (contract)  ◄── SharedArrayBuffer ──►  WorkerPool   │
└──────────────────────────────────┬────────────────────────────────┘
                                   │ postMessage (task dispatch only)
┌────────────────────────────── workers ────────────────────────────┐
│  workerBootstrap binds same contract  →  TaskRegistry handlers    │
│  read/write the SAME memory — results stream back via postMessage │
└───────────────────────────────────────────────────────────────────┘`;

const QUICKSTART = `import { defineSharedMemory, field, WorkerPool } from '@jwhenry123/mesh/sdk';

// 1. One contract, imported by both threads.
export const memory = defineSharedMemory({
  counter: field.number(),
  stats: field.object({ maxBytes: 2048 }), // 2KB encoded budget
});

// 2. A task contract + a pool that binds the contract.
const pool = new WorkerPool({
  createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  sharedMemory: memory,
  tasks: { addDelta: AddDelta }, // → pool.addDelta(n)
});`;

const REQUIREMENTS = `\
# SharedArrayBuffer only exists in cross-origin-isolated contexts.
# Every app must serve COOP/COEP headers (all examples do this):

Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp`;

export function Overview() {
  return (
    <article>
      <h1>mesh — the Worker Mesh</h1>
      <p className="lead">
        A worker mesh: worker pools and shared workers joined to your app
        through one shared-memory fabric. Threads share a fixed-layout{' '}
        <code>SharedArrayBuffer</code> contract; workers scan, sort, and write in
        place; work is offloaded two ways — task <em>commands</em> and{' '}
        <em>state reactivity</em> — while only task inputs and explicit results
        cross <code>postMessage</code>.
      </p>

      <h2>How it fits together</h2>
      <CodeBlock code={ARCH} language="plaintext" />
      <p>
        Three layers: <strong>contracts</strong> (<code>defineSharedMemory</code> +{' '}
        <code>field.*</code>) declare the memory layout once for both threads; the{' '}
        <strong>pool</strong> (<code>WorkerPool</code> + <code>TaskRegistry</code> +
        worker bootstrap) dispatches typed tasks; <strong>reactivity</strong> (
        <code>observe</code>, <code>watch</code>, <code>defineTask</code>) turns shared
        fields and task runs into subscribable snapshots that framework bindings adapt.
      </p>

      <h2>Repository layout</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Path</th><th>Contents</th></tr>
        </thead>
        <tbody>
          <tr><td><code>src/sdk/</code></td><td><code>@jwhenry123/mesh/sdk</code> — contracts, pool, worker runtime, reactivity, logging</td></tr>
          <tr><td><code>packages/incidents/</code></td><td><code>@jwhenry123/mesh-incidents</code> — the demo domain: incident contract, worker, pool, tasks</td></tr>
          <tr><td><code>packages/&lt;framework&gt;/</code></td><td><code>@jwhenry123/mesh-&lt;framework&gt;</code> — generic bindings, no domain code</td></tr>
          <tr><td><code>examples/&lt;framework&gt;/</code></td><td>Six isolated apps composing incidents + bindings</td></tr>
        </tbody>
      </table>

      <h2>Quickstart</h2>
      <CodeBlock code={QUICKSTART} file="contract + pool" />

      <h2>Browser requirements</h2>
      <CodeBlock code={REQUIREMENTS} language="bash" />
      <p>
        The examples set these headers in <code>server.headers</code> (Vite),{' '}
        <code>angular.json</code> dev-server options, and <code>headers()</code> in
        Next config. Without them, <code>SharedArrayBuffer</code> is undefined and the
        pool cannot bind.
      </p>

      <h2>Running everything</h2>
      <CodeBlock
        code={`npm run dev:all    # dev servers: root :4173 · docs :4180 · react :5173 · vue :5174
                   # solid :5175 · svelte :5176 · angular :4201 · next :3001

npm run serve:all  # builds all apps into dist/<name>/ and serves one origin:
                   #   http://localhost:4173  →  /docs/ /react/ /vue/ /solid/ /svelte/ /angular/
                   # nextjs stays server-rendered on :3001 (--no-build skips rebuilding)`}
        language="bash"
      />
    </article>
  );
}
