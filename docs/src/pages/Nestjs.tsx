import { CodeBlock } from '../components/CodeBlock';
import moduleSrc from '../../../packages/nestjs/src/module.ts?raw';
import decoratorsSrc from '../../../packages/nestjs/src/decorators.ts?raw';
import workerSrc from '../../../packages/nestjs/src/worker.ts?raw';
import serviceSrc from '../../../examples/nestjs/src/shared/incidents-analytics.service.ts?raw';
import workerEntrySrc from '../../../examples/nestjs/src/digest.worker.ts?raw';
import webpackConfigSrc from '../../../examples/nestjs/webpack.config.js?raw';
import nestCliSrc from '../../../examples/nestjs/nest-cli.json?raw';

const port = 3100;
const apiBase = `${window.location.protocol}//${window.location.hostname}:${port}`;
const ENDPOINTS = [
  ['POST', '/api/incidents/seed', 'pool task — seeds 1M records on a worker'],
  ['GET', '/api/incidents/stats', 'computeMetrics task over shared memory'],
  ['GET', '/api/incidents/hotspots?limit=5', '@MeshTask service body in a worker'],
  ['GET', '/api/incidents/42', 'direct shared-memory read on the API thread'],
  ['POST', '/api/digest/hash', 'second pool — SHA-256 chain on a worker'],
  ['GET', '/api/digest/worker', 'the answering worker’s threadId + telemetry'],
];

const APIS = [
  { name: 'MeshModule.forRoot', signature: 'forRoot({ pools: MeshPoolConfig[] })', desc: 'One WorkerPool per entry: name, workerFile, sharedMemory, poolSize, tasks. Pools become injectable providers and terminate on module destroy.' },
  { name: '@MeshTask', signature: '@MeshTask(taskId | contract | { pool })', desc: 'RPC-style offload — main-thread calls dispatch to the named pool; the body executes inside the worker’s Nest context on the DI-resolved instance.' },
  { name: '@InjectMeshPool', signature: '@InjectMeshPool(name)', desc: 'Parameter decorator injecting a configured pool for first-class task methods / runTask.' },
  { name: 'runMeshWorker', signature: 'runMeshWorker(module): Promise<INestApplicationContext>', desc: 'Worker-side bootstrap — creates a Nest application context, discovers @MeshTask providers via DiscoveryService, binds them into TaskRegistry.' },
  { name: 'registerMeshHandlers', signature: 'registerMeshHandlers(...instances)', desc: 'Explicit registration for instances created outside a worker Nest context.' },
  { name: 'createNodeWorker', signature: 'createNodeWorker(source | worker): Worker', desc: 'Adapts node:worker_threads.Worker (EventEmitter) to the DOM Worker surface the pool expects — or wraps an existing Worker so `new Worker(new URL(...))` stays webpack-detectable.' },
];

/**
 * Server-side binding — NestJS apps run the mesh inside node:worker_threads.
 * No browser, no iframe: the "live demo" is the REST API itself on :3100.
 */
export function Nestjs() {
  return (
    <article>
      <h1>NestJS</h1>
      <p className="lead">
        <code>@jwhenry123/mesh-nestjs</code> — worker pools on the server.
        Decorated service methods become RPC endpoints into{' '}
        <code>node:worker_threads</code> workers that each boot their own Nest
        application context — same module, real DI, both sides.
      </p>

      <h2>Live API</h2>
      <p>
        The example is a server — start it with <code>npm run serve:all</code>{' '}
        (or <code>npm run dev:all</code>) and it answers on{' '}
        <a href={`${apiBase}/api/incidents/stats`} target="_blank" rel="noreferrer">
          {window.location.hostname}:{port}
        </a>
        . Two pools: <code>incidents</code> (24 workers, 1M-record shared
        buffer) and <code>digest</code> (2 workers, tiny counter buffer).
      </p>
      <table className="doc-table">
        <thead>
          <tr><th>Method</th><th>Path</th><th>Runs on</th></tr>
        </thead>
        <tbody>
          {ENDPOINTS.map(([m, path, desc]) => (
            <tr key={path}>
              <td><code>{m}</code></td>
              <td><a href={`${apiBase}${path}`} target="_blank" rel="noreferrer"><code>{path}</code></a></td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Binding API</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Export</th><th>Signature</th><th>What it does</th></tr>
        </thead>
        <tbody>
          {APIS.map((api) => (
            <tr key={api.name}>
              <td><code>{api.name}</code></td>
              <td><code>{api.signature}</code></td>
              <td>{api.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>MeshModule — pool configuration</h2>
      <p>
        One module call wires every pool: each becomes an injectable provider,
        registers in the pool registry <code>@MeshTask</code> dispatches
        through, and terminates on module destroy.
      </p>
      <CodeBlock code={moduleSrc} file="packages/nestjs/src/module.ts" />

      <h2>@MeshTask — the decorator decides the thread</h2>
      <p>
        Main thread: the call serializes args and dispatches{' '}
        <code>EXECUTE_TASK</code> to the pool. Worker side: the decorator only
        records metadata — <code>runMeshWorker</code> binds the real body to
        the DI-created instance.
      </p>
      <CodeBlock code={decoratorsSrc} file="packages/nestjs/src/decorators.ts" />

      <h2>runMeshWorker — a Nest context inside the worker</h2>
      <p>
        The worker boots its own application context and discovers decorated
        providers, so injected dependencies resolve inside worker-run bodies.
      </p>
      <CodeBlock code={workerSrc} file="packages/nestjs/src/worker.ts" />

      <h2>Usage — one service, two runtimes</h2>
      <p>
        The same class file is the contract: calling a decorated method on the
        API thread looks like an ordinary async call; the body runs inside a
        worker where <code>ScanTelemetry</code> is a real injected instance.
      </p>
      <CodeBlock code={serviceSrc} file="examples/nestjs/src/shared/incidents-analytics.service.ts" />

      <h2>Worker entry</h2>
      <p>
        Each pool’s worker is a few lines: <code>node/shim</code> first (binds{' '}
        <code>self = parentPort</code>), the bootstrap import, then{' '}
        <code>runMeshWorker</code> on the shared module.
      </p>
      <CodeBlock code={workerEntrySrc} file="examples/nestjs/src/digest.worker.ts" />

      <h2>Build — plain <code>nest build</code></h2>
      <p>
        No custom build script: <code>nest-cli.json</code> enables webpack. The
        pool config's <code>createWorker</code> factory wraps{' '}
        <code>new Worker(new URL('./x.worker.ts', import.meta.url))</code> —
        webpack detects the pattern, compiles each worker entry as its own
        chunk, and rewrites the URL to the emitted file, so the config
        references the TS source directly. The factory only needs{' '}
        <code>TsconfigPathsPlugin</code> for the mesh aliases, and{' '}
        <code>node/shim</code> as each worker's first import binds{' '}
        <code>self = parentPort</code> — no bundler banner needed.
      </p>
      <CodeBlock code={nestCliSrc} file="examples/nestjs/nest-cli.json" language="json" />
      <CodeBlock code={webpackConfigSrc} file="examples/nestjs/webpack.config.js" language="javascript" />

      <h2>Notes</h2>
      <ul>
        <li>No COOP/COEP needed — Node always allows SharedArrayBuffer.</li>
        <li>nest build (webpack/ts-loader) honors emitDecoratorMetadata; explicit @Inject tokens are optional but harmless.</li>
        <li>Keep worker entry imports free of main-thread side effects; only the pool's own contracts should be defined in its module graph (each pool hands its workers one buffer).</li>
        <li>Args/results cross postMessage — keep them small; big data lives in the shared buffer.</li>
      </ul>
    </article>
  );
}
