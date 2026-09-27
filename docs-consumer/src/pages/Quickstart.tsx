import { CodeBlock } from '../components/CodeBlock';

export function Quickstart() {
  return (
    <article>
      <h1>Quickstart</h1>
      <p className="lead">
        A minimal counter: one shared field, one worker method, one component.
        Four files, and the method name is written exactly once.
      </p>

      <h2>1 · Install</h2>
      <CodeBlock code="npm install @jwhenry123/mesh @jwhenry123/mesh-react" language="bash" />

      <h2>2 · Declare shared memory — imported by both threads</h2>
      <CodeBlock
        file="counter.memory.ts"
        code={`import { defineSharedMemory, field } from '@jwhenry123/mesh/sdk';

export const counterMemory = defineSharedMemory({
  count: field.number(),
});`}
      />

      <h2>3 · Define the worker — methods live here</h2>
      <CodeBlock
        file="counter.worker.ts"
        code={`import { defineWorker } from '@jwhenry123/mesh/sdk';
import { counterMemory } from './counter.memory';

// defineWorker wires the message loop and registers every method.
// Plain functions type the client from their signature.
export const counterWorker = defineWorker({
  sharedMemory: counterMemory,
  methods: {
    increment(delta: number) {
      const next = counterMemory.count.read() + delta;
      counterMemory.count.write(next);  // write in place — no postMessage
      return next;
    },
  },
});
export type CounterWorker = typeof counterWorker;`}
      />

      <h2>4 · Connect from the main thread — type only</h2>
      <CodeBlock
        file="counter.ts"
        code={`import { connectWorker } from '@jwhenry123/mesh/sdk';
import { counterMemory } from './counter.memory';
import type { CounterWorker } from './counter.worker';  // no worker code in this bundle

export const counter = connectWorker<CounterWorker>({
  sharedMemory: counterMemory,
  // Inline new Worker(new URL(..., import.meta.url)) — every bundler's
  // worker transform can see the entry point this way.
  worker: () => new Worker(new URL('./counter.worker.ts', import.meta.url), { type: 'module' }),
  poolSize: 'auto',   // navigator.hardwareConcurrency, or pass a number
});
// counter.increment(1) → Promise<number>. The pool spawns on first call
// (SSR-safe to import); counter.terminate() tears it down.`}
      />

      <h2>5 · Bind it in your framework</h2>
      <CodeBlock
        file="App.tsx"
        language="tsx"
        code={`import { useSharedValue, useTask } from '@jwhenry123/mesh-react';
import { counterMemory } from './counter.memory';
import { counter } from './counter';

export function App() {
  const count = useSharedValue(counterMemory, 'count');
  const increment = useTask(counter.increment);   // any async fn → latest-wins task state
  return (
    <button onClick={() => increment.run(1)}>count: {count ?? '…'}</button>
  );
}`}
      />
      <p>
        That's the whole loop — <code>increment.run(1)</code> posts the call to a
        worker, the worker writes <code>count</code> in place, and the binding
        re-renders on the next field write. No serialization of the value itself.
        Need validation at the boundary? Swap the plain function for a{' '}
        <code>serviceMethod({'{ def: { argsSchema, resultSchema }, run }'})</code> unit —
        see <a href="#/tasks">Worker pool &amp; tasks</a>.
      </p>

      <h2>Shared memory is opt-in</h2>
      <p>
        Leave <code>sharedMemory</code> out of both <code>defineWorker</code> and{' '}
        <code>connectWorker</code> and you have a typed, pooled, cancellable
        worker RPC that runs anywhere Workers do — no isolation headers needed.
        Add the contract when a worker owns state the UI should observe without
        copying.
      </p>

      <h2>With shared memory: cross-origin isolation</h2>
      <p>
        <code>SharedArrayBuffer</code> only exists when the page is
        cross-origin isolated. Vite example:
      </p>
      <CodeBlock
        file="vite.config.ts"
        code={`export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});`}
      />
      <p>
        Production hosting needs the same headers — see{' '}
        <a href="#/hosting">Hosting &amp; headers</a>.
      </p>
    </article>
  );
}
