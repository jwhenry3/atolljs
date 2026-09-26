import { useEffect } from 'react';
import { useSharedValue, useTask } from '@jwhenry123/mesh/react';
import { CodeBlock } from '../components/CodeBlock';
import { addTask, getDemoPool, pingTask } from '../demo/demo.pool';
import { demoMemory } from '../demo/demo.contract';
import contractSource from '../demo/demo.contract.ts?raw';
import workerSource from '../demo/demo.worker.ts?raw';
import poolSource from '../demo/demo.pool.ts?raw';
import pageSource from './Playground.tsx?raw';

/**
 * Live playground — a real worker bound to a real shared-memory contract,
 * driven through the same @jwhenry123/mesh/react bindings the examples use.
 */
export function Playground() {
  // Bind the contract + spawn the worker on mount.
  useEffect(() => {
    getDemoPool();
  }, []);

  const counter = useSharedValue(demoMemory, 'counter');
  const ops = useSharedValue(demoMemory, 'ops');
  const add = useTask(addTask);
  const ping = useTask(pingTask);

  return (
    <article>
      <h1>Playground</h1>
      <p className="lead">
        Everything below runs live in this page: a worker writes to shared memory and
        the counters update through <code>observe()</code> — no postMessage for the
        values themselves.
      </p>

      <div className="playground">
        <div className="playground-stats">
          <div className="metric">
            <span className="metric-value">{counter ?? '—'}</span>
            <span>counter (shared field)</span>
          </div>
          <div className="metric">
            <span className="metric-value">{ops ?? '—'}</span>
            <span>ops executed</span>
          </div>
        </div>
        <div className="playground-actions">
          <button disabled={add.pending} onClick={() => add.run(1)}>worker: +1</button>
          <button disabled={add.pending} onClick={() => add.run(100)}>worker: +100</button>
          <button disabled={add.pending} onClick={() => add.run(-50)}>worker: −50</button>
          <button disabled={ping.pending} onClick={() => ping.run()}>
            {ping.pending ? 'pinging…' : 'ping worker'}
          </button>
        </div>
        {ping.data && (
          <p className="playground-out">
            {ping.data} · round-trip {ping.elapsedMs?.toFixed(1)}ms
          </p>
        )}
      </div>

      <h2>The code running this page</h2>
      <h3>Contract — imported by both threads</h3>
      <CodeBlock code={contractSource} file="docs/src/demo/demo.contract.ts" />
      <h3>Worker</h3>
      <CodeBlock code={workerSource} file="docs/src/demo/demo.worker.ts" />
      <h3>Pool + tasks</h3>
      <CodeBlock code={poolSource} file="docs/src/demo/demo.pool.ts" />
      <h3>This page</h3>
      <CodeBlock code={pageSource} file="docs/src/pages/Playground.tsx" language="tsx" />
    </article>
  );
}
