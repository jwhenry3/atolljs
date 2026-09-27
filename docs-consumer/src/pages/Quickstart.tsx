import { CodeBlock } from '../components/CodeBlock';

export function Quickstart() {
  return (
    <article>
      <h1>Quickstart</h1>
      <p className="lead">
        A minimal counter: one shared field, one task, one worker. Five steps.
      </p>

      <h2>1 · Install</h2>
      <CodeBlock code="npm install @jwhenry123/mesh @jwhenry123/mesh-react" language="bash" />

      <h2>2 · Declare the contract — shared by both threads</h2>
      <CodeBlock
        file="counter.contract.ts"
        code={`import { defineSharedMemory, field } from '@jwhenry123/mesh/sdk';
import type { TaskContract } from '@jwhenry123/mesh/sdk';
import { z } from 'zod';

export const counterMemory = defineSharedMemory({
  count: field.number(),
});

// Task contracts are plain objects — argsSchema/resultSchema validate
// values as they cross the thread boundary via postMessage.
export const Increment: TaskContract<[delta: number], number> = {
  taskId: 'increment',
  argsSchema: z.tuple([z.number()]),
  resultSchema: z.number(),
};`}
      />

      <h2>3 · Implement the handler — runs inside the worker</h2>
      <CodeBlock
        file="counter.worker.ts"
        code={`import '@jwhenry123/mesh/sdk/worker/workerBootstrap';
import { TaskRegistry } from '@jwhenry123/mesh/sdk';
import { counterMemory, Increment } from './counter.contract';

TaskRegistry.register(Increment, (delta) => {
  const next = counterMemory.count.read() + delta;
  counterMemory.count.write(next);  // write in place — no postMessage
  return next;
});`}
      />

      <h2>4 · Spawn the pool on the main thread</h2>
      <CodeBlock
        file="counter.pool.ts"
        code={`import { defineTask, WorkerPool } from '@jwhenry123/mesh/sdk';
import { counterMemory, Increment } from './counter.contract';

export const pool = new WorkerPool({
  // Inline new Worker(new URL(..., import.meta.url)) — every bundler's
  // worker transform can see the entry point this way.
  createWorker: () => new Worker(new URL('./counter.worker.ts', import.meta.url), { type: 'module' }),
  sharedMemory: counterMemory,
  poolSize: 'auto',   // navigator.hardwareConcurrency, or pass a number
  tasks: { increment: Increment },
});

// Latest-wins async runners with data/pending/elapsedMs snapshots —
// the binding's useTask/taskState adapt these.
export const initTask = defineTask<void, void>(async () => {});
export const incrementTask = defineTask((delta: number) => pool.increment(delta));`}
      />

      <h2>5 · Bind it in your framework</h2>
      <CodeBlock
        file="App.tsx"
        language="tsx"
        code={`import { useSharedValue, useTask } from '@jwhenry123/mesh-react';
import { counterMemory } from './counter.contract';
import { incrementTask } from './counter.pool';

export function App() {
  const count = useSharedValue(counterMemory, 'count');
  const increment = useTask(incrementTask);
  return (
    <button onClick={() => increment.run(1)}>count: {count ?? '…'}</button>
  );
}`}
      />
      <p>
        That's the whole loop — <code>increment.run(1)</code> posts the task to a
        worker, the worker writes <code>count</code> in place, and the binding
        re-renders on the next field write. No serialization of the value itself.
      </p>

      <h2>Required: cross-origin isolation</h2>
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
