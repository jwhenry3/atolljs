import { CodeBlock } from '../components/CodeBlock';

const host = `${window.location.protocol}//${window.location.hostname}`;
const examples = [
  { id: 'express', name: 'Express', port: 3200, pkg: 'express' },
  { id: 'fastify', name: 'Fastify', port: 3201, pkg: 'fastify' },
  { id: 'hono', name: 'Hono', port: 3202, pkg: 'hono + @hono/node-server' },
  { id: 'koa', name: 'Koa', port: 3203, pkg: 'koa + @koa/router' },
];

const APIS = [
  { name: 'createNodePool', signature: 'createNodePool({ worker | workerFile | createWorker, sharedMemory?, poolSize?, … })', desc: 'A WorkerPool backed by node:worker_threads — identical config to new WorkerPool except the worker is declared as a bundled file path or a factory.' },
  { name: 'worker spec', signature: 'worker: string | URL | (() => Worker | NodeWorker)', desc: 'A factory may return node:worker_threads.Worker directly — it is auto-adapted, so new Worker(new URL(\'./x.worker.js\', import.meta.url)) needs no wrapper.' },
  { name: 'workerClient', signature: 'workerClient<WorkerDef>(runner | () => runner)', desc: 'Typed Proxy over the pool — calls read like the worker\'s own method names: client.computeMetrics(). From @atolljs/core.' },
  { name: 'createNodeWorker', signature: 'createNodeWorker(file | url | nodeWorker, options?)', desc: 'Wrap a Node Worker (or worker file) in the DOM Worker surface — for connectWorker or a hand-built WorkerPool.' },
  { name: 'NodeWorkerAdapter', signature: 'class NodeWorkerAdapter', desc: 'The EventEmitter → EventTarget adapter underneath createNodeWorker.' },
  { name: '@atolljs/node/shim', signature: "import '@atolljs/node/shim'", desc: 'Worker-side entry shim — binds globalThis.self = parentPort before workerBootstrap wires INIT_MEMORY / EXECUTE_TASK. Must be the first import.' },
];

const USAGE_POOL = `// src/incidents.ts — the atoll on the server: a WorkerPool of
// node:worker_threads workers bound to the shared-memory contract.
import { Worker } from 'node:worker_threads';
import { workerClient } from '@atolljs/core';
import { createNodePool } from '@atolljs/node';
import { incidentsMemory, type IncidentsWorker } from '@atolljs/incidents';

export const pool = createNodePool({
  // The bundled worker entry — see "Bundling the worker" below.
  worker: () => new Worker(new URL('../dist/incidents.worker.js', import.meta.url)),
  sharedMemory: incidentsMemory,
  poolSize: 'auto',
});

// Typed client — calls read like the worker's own method names.
export const incidents = workerClient<IncidentsWorker>(pool);

// Direct shared-memory reads cost nothing — no dispatch:
export const seedProgress = () => incidentsMemory.signals.seedProgress.read();
export const readIncident = (id: number) =>
  incidentsMemory.lists.incidents.readAt(id, {} as Incident);`;

const USAGE_WORKER = `// src/incidents.worker.ts — the shim binds self = parentPort BEFORE
// workerBootstrap (inside defineWorker) evaluates. Import order is the
// contract; the incidents module registers its task handlers on import.
import '@atolljs/node/shim';
import '@atolljs/incidents/worker/incidents.worker';`;

const USAGE_EXPRESS = `import express from 'express';
import { incidents, parseQueryArgs, readIncident, seedProgress } from './incidents';

const app = express();

app.post('/api/incidents/seed', async (_req, res) => {
  res.json({ seeded: true, ms: await incidents.seedIncidents() });
});
app.get('/api/incidents/seed-progress', (_req, res) => {
  res.json({ progress: seedProgress() });
});
app.get('/api/incidents/stats', async (_req, res) => {
  res.json(await incidents.computeMetrics());
});
app.get('/api/incidents/query', async (req, res) => {
  res.json(await incidents.queryIncidents(parseQueryArgs(req.query)));
});
app.get('/api/incidents/:id', (req, res) => {
  const rec = readIncident(Number(req.params.id));
  if (!rec) { res.status(404).json({ error: 'out of range' }); return; }
  res.json(rec);
});

const server = app.listen(port, () => {
  void incidents.seedIncidents().catch(console.error); // seed on bootstrap
});
process.on('SIGINT', () => { pool.terminate(); server.close(() => process.exit(0)); });`;

const USAGE_FASTIFY = `import Fastify from 'fastify';
import { incidents, parseQueryArgs, readIncident, seedProgress } from './incidents';

const app = Fastify();

app.post('/api/incidents/seed', async () => ({
  seeded: true, ms: await incidents.seedIncidents(),
}));
app.get('/api/incidents/seed-progress', async () => ({ progress: seedProgress() }));
app.get('/api/incidents/stats', async () => incidents.computeMetrics());
app.get('/api/incidents/query', async (req) =>
  incidents.queryIncidents(parseQueryArgs(req.query as Record<string, unknown>)));
app.get('/api/incidents/:id', async (req, reply) => {
  const rec = readIncident(Number((req.params as { id: string }).id));
  if (!rec) return reply.code(404).send({ error: 'out of range' });
  return rec;
});

await app.listen({ port });
void incidents.seedIncidents().catch(console.error); // seed on bootstrap`;

const USAGE_HONO = `import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { incidents, parseQueryArgs, readIncident, seedProgress } from './incidents';

const app = new Hono();

app.post('/api/incidents/seed', async (c) =>
  c.json({ seeded: true, ms: await incidents.seedIncidents() }));
app.get('/api/incidents/seed-progress', (c) => c.json({ progress: seedProgress() }));
app.get('/api/incidents/stats', async (c) => c.json(await incidents.computeMetrics()));
app.get('/api/incidents/query', async (c) =>
  c.json(await incidents.queryIncidents(parseQueryArgs(c.req.query()))));
app.get('/api/incidents/:id', (c) => {
  const rec = readIncident(Number(c.req.param('id')));
  if (!rec) return c.json({ error: 'out of range' }, 404);
  return c.json(rec);
});

const server = serve({ fetch: app.fetch, port }, () => {
  void incidents.seedIncidents().catch(console.error); // seed on bootstrap
});`;

const USAGE_KOA = `import Koa from 'koa';
import Router from '@koa/router';
import { incidents, parseQueryArgs, readIncident, seedProgress } from './incidents';

const app = new Koa();
const router = new Router();

router.post('/api/incidents/seed', async (ctx) => {
  ctx.body = { seeded: true, ms: await incidents.seedIncidents() };
});
router.get('/api/incidents/seed-progress', (ctx) => {
  ctx.body = { progress: seedProgress() };
});
router.get('/api/incidents/stats', async (ctx) => {
  ctx.body = await incidents.computeMetrics();
});
router.get('/api/incidents/query', async (ctx) => {
  ctx.body = await incidents.queryIncidents(parseQueryArgs(ctx.query));
});
router.get('/api/incidents/:id', (ctx) => {
  const rec = readIncident(Number(ctx.params.id));
  if (!rec) { ctx.status = 404; ctx.body = { error: 'out of range' }; return; }
  ctx.body = rec;
});

app.use(router.routes()).use(router.allowedMethods());
const server = app.listen(port, () => {
  void incidents.seedIncidents().catch(console.error); // seed on bootstrap
});`;

const USAGE_BUNDLE = `// package.json — the worker entry is bundled once; the app runs under tsx.
// esbuild resolves the tsconfig paths (@atolljs/* → repo sources) inline;
// real npm deps stay external.
{
  "scripts": {
    "bundle": "esbuild src/incidents.worker.ts --bundle --platform=node
               --format=esm --packages=external
               --outfile=dist/incidents.worker.js",
    "dev": "npm run bundle && tsx watch src/main.ts",
    "build": "tsc --noEmit && npm run bundle",
    "start": "npm run bundle && tsx src/main.ts"
  }
}`;

export function NodeBackends() {
  return (
    <article>
      <h1>Node.js backends — Express, Fastify, Hono, Koa</h1>
      <p className="lead">
        <code>@atolljs/node</code> puts the worker atoll on any Node HTTP
        framework, no adapter package needed: a{' '}
        <code>WorkerPool</code> of <code>node:worker_threads</code> workers
        shares one buffer with the API thread, heavy scans dispatch to the
        pool, and record reads hit shared memory directly for zero-dispatch
        responses. Nest apps get decorators and DI on top (
        <a href="#/fw-nestjs">Backend → NestJS</a>); these examples show the
        plain-Node surface underneath.
      </p>

      <h2>Install</h2>
      <CodeBlock code="npm install @atolljs/core @atolljs/node" language="bash" />

      <h2>The pool + typed client</h2>
      <p>
        One module owns the pool: <code>createNodePool</code> adapts{' '}
        <code>node:worker_threads.Worker</code> to the DOM surface the pool
        expects, and <code>workerClient&lt;IncidentsWorker&gt;</code> makes
        every dispatch read like a method call. Shared-memory fields are
        readable on the API thread for free — <code>seedProgress</code> and
        record-by-id never touch a worker.
      </p>
      <CodeBlock code={USAGE_POOL} file="src/incidents.ts" />
      <CodeBlock code={USAGE_WORKER} file="src/incidents.worker.ts" />

      <h2>The HTTP adapter — pick your framework</h2>
      <p>
        Same five routes in each example: <code>POST /api/incidents/seed</code>,
        {' '}<code>GET /seed-progress</code>, <code>GET /stats</code>,{' '}
        <code>GET /query?severity=critical&amp;status=open</code>,{' '}
        <code>GET /:id</code>. Only the route syntax differs — the pool and
        worker files are identical across all four.
      </p>
      <h3>Express</h3>
      <CodeBlock code={USAGE_EXPRESS} file="src/main.ts" />
      <h3>Fastify</h3>
      <CodeBlock code={USAGE_FASTIFY} file="src/main.ts" />
      <h3>Hono</h3>
      <CodeBlock code={USAGE_HONO} file="src/main.ts" />
      <h3>Koa</h3>
      <CodeBlock code={USAGE_KOA} file="src/main.ts" />

      <h2>Bundling the worker — required on plain Node</h2>
      <p>
        <code>node:worker_threads</code> spawns each worker as a fresh Node
        process. Loader hooks — tsx, <code>--import tsx</code>, tsconfig{' '}
        <code>paths</code> — do <strong>not</strong> propagate into worker
        threads, so an unbundled <code>.ts</code> worker entry can't resolve
        bare <code>@atolljs/*</code> specifiers. Bundle the entry once with
        esbuild (or your bundler of choice) and point the pool at the emitted
        file; the API code itself can keep running unbundled under tsx.
      </p>
      <CodeBlock code={USAGE_BUNDLE} file="package.json" language="json" />
      <p>
        This differs from the NestJS example, where webpack detects{' '}
        <code>new Worker(new URL('./x.worker.ts', import.meta.url))</code> in
        the pool config and emits the worker chunk itself — esbuild does not
        rewrite worker URLs, so the <code>worker:</code> factory references{' '}
        <code>dist/</code> directly (the documented{' '}
        <code>workerFile</code>/<code>worker</code> spec for plain-Node
        deployments).
      </p>

      <h2>Node API</h2>
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

      <h2>Live examples</h2>
      <p>
        The repo ships all four under <code>examples/</code>. Start them via{' '}
        <code>npm run dev</code> in each dir or{' '}
        <code>npm run serve:all</code> from the repo root, then:
      </p>
      <ul>
        {examples.map((ex) => (
          <li key={ex.id}>
            <strong>{ex.name}</strong> (
            <a href={`${host}:${ex.port}/api/incidents/stats`} target="_blank" rel="noreferrer">
              <code>{host}:{ex.port}/api/incidents/stats</code>
            </a>
            ) — <code>examples/{ex.id}</code>, dep: <code>{ex.pkg}</code>
          </li>
        ))}
      </ul>

      <h2>Notes</h2>
      <ul>
        <li>No COOP/COEP needed — Node always allows <code>SharedArrayBuffer</code>.</li>
        <li><code>poolSize: 'auto'</code> sizes to cores; one pool per process is typical — every route shares it.</li>
        <li>Args/results cross <code>postMessage</code> (structured clone) — keep them small; the shared buffer carries the large state.</li>
        <li>Terminate the pool on shutdown (<code>pool.terminate()</code> in SIGINT/SIGTERM) so workers don't outlive the server.</li>
        <li>Each example's <code>test/api.e2e.test.ts</code> spawns the real server on an ephemeral port and exercises every route — the same flow <code>npm test</code> runs.</li>
      </ul>
    </article>
  );
}
