import { useState } from 'react';
import type { Logger } from '../sdk/index';
import { runBenchmark } from '../examples/benchmark/main';
import { runDemo as runComputeSum } from '../examples/main';
import { runMarketDemo } from '../examples/market/main';
import { runDemo as runSimulation } from '../examples/simulation/main';

interface Demo {
  title: string;
  description: string;
  run: (log: Logger) => Promise<void>;
}

const FRAMEWORKS = [
  { id: 'consumer', name: 'Package Docs', port: 4181, detail: 'npm consumer guide & API reference' },
  { id: 'react', name: 'React', port: 5173, detail: 'useSyncExternalStore hooks + TanStack Table' },
  { id: 'vue', name: 'Vue', port: 5174, detail: 'Composition API refs + watchers' },
  { id: 'solid', name: 'SolidJS', port: 5175, detail: 'Signals + reactive effects' },
  { id: 'svelte', name: 'Svelte', port: 5176, detail: 'Svelte 5 runes' },
  { id: 'angular', name: 'Angular', port: 4201, detail: 'Zoneless signals + effects' },
  { id: 'nextjs', name: 'Next.js', port: 3001, detail: 'App Router + client boundary' },
  { id: 'nestjs', name: 'NestJS', port: 3100, detail: 'REST API — the pool does the heavy lifting' },
];

// Built output lives under dist/<id>/ on this origin; dev servers run per-port.
// Next.js and NestJS are server-side apps — they always run on their own port.
// ?v=<build stamp> defeats stale caches for the document URL (index.html
// keeps a stable name — only its query changes per build).
function frameworkHref(id: string, port: number) {
  const base =
    import.meta.env.DEV || id === 'nextjs' || id === 'nestjs'
      ? `${window.location.protocol}//${window.location.hostname}:${port}`
      : `/${id}/`;
  return `${base}?v=${__BUILD_ID__}`;
}

const DEMOS: Demo[] = [
  {
    title: 'Compute Sum',
    description:
      'Fills a shared Float64 array, sums it on a worker, and returns a structured result object through shared memory.',
    run: runComputeSum,
  },
  {
    title: 'Entity Simulation',
    description:
      'Shares a zod-validated entity list between threads. The worker advances positions while the main thread mutates entities between ticks.',
    run: runSimulation,
  },
  {
    title: 'Market Gateway',
    description:
      'A live quote cache: the worker feeds 500k random-access ticks into 10k list records, the main thread screens the market and reacts to published breadth stats.',
    run: runMarketDemo,
  },
  {
    title: 'Benchmark',
    description:
      'Stress test: task dispatch throughput, zero-copy vs connector vs structured writes, cross-thread notification delivery, and a json/msgpack codec bake-off.',
    run: runBenchmark,
  },
];

type Status = 'idle' | 'running' | 'done' | 'error';

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? arg.message;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function DemoCard({ demo }: { demo: Demo }) {
  const [status, setStatus] = useState<Status>('idle');
  const [logs, setLogs] = useState<string[]>([]);

  const run = async () => {
    setLogs([]);
    setStatus('running');
    const log: Logger = (...args) =>
      setLogs((prev) => [...prev, args.map(formatArg).join(' ')]);
    try {
      await demo.run(log);
      setStatus('done');
    } catch (err) {
      log('Error:', err);
      setStatus('error');
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>{demo.title}</h2>
          <p>{demo.description}</p>
        </div>
        <button onClick={run} disabled={status === 'running'}>
          {status === 'running' ? 'Running…' : 'Run'}
        </button>
      </div>
      <pre className="log">
        {logs.length ? logs.join('\n') : status === 'idle' ? 'Click Run to start.' : ''}
      </pre>
      {status === 'error' && <p className="error">Failed — see log above.</p>}
    </section>
  );
}

export function App() {
  return (
    <main>
      <h1>Worker Atoll Demos</h1>
      <p className="subtitle">
        Each demo spawns a worker pool bound to a shared memory contract.
      </p>

      <section className="frameworks">
        <div className="section-heading">
          <div>
            <h2>Incident Explorer</h2>
            <p>The same million-record shared-memory app across six frameworks.</p>
          </div>
          <code>npm run serve:all</code>
        </div>
        <nav className="framework-grid" aria-label="Incident Explorer frameworks">
          {FRAMEWORKS.map((framework) => (
            <a
              key={framework.name}
              className="framework-link"
              href={frameworkHref(framework.id, framework.port)}
            >
              <strong>{framework.name}</strong>
              <span>{framework.detail}</span>
              <small>{frameworkHref(framework.id, framework.port)} →</small>
            </a>
          ))}
        </nav>
      </section>

      <h2 className="demos-heading">SDK demos</h2>
      {DEMOS.map((demo) => (
        <DemoCard key={demo.title} demo={demo} />
      ))}
    </main>
  );
}
