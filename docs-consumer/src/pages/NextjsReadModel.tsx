import { CodeBlock } from '../components/CodeBlock';
import { docHref } from '../link';

const POOL = `// src/app/api/incidents/pool.ts — one pool, bound to the 1M-record buffer
import { Worker } from 'node:worker_threads';
import { workerClient } from '@atolljs/core';
import { createNodePool, createNodeWorker } from '@atolljs/node';
import { incidentsMemory } from '@atolljs/incidents';
import type { IncidentsWorker } from '@atolljs/incidents'; // type only

const create = () => {
  const pool = createNodePool({
    sharedMemory: incidentsMemory,
    poolSize: 2,
    createWorker: () => createNodeWorker(
      new Worker(new URL('./incidents.worker.ts', import.meta.url))),
  });
  return { pool, client: workerClient<IncidentsWorker>(pool),
           memory: incidentsMemory };   // the instance the pool bound
};

export const getIncidentsApi = (): ReturnType<typeof create> => {
  const g = globalThis as { __atollIncidents?: ReturnType<typeof create> };
  return (g.__atollIncidents ??= create());
};`;

const STATS = `// src/app/api/incidents/route.ts — reads never touch a worker
export async function GET() {
  const { memory } = getIncidentsApi();
  return NextResponse.json({
    seedProgress: memory.signals.seedProgress.read(),
    metrics: memory.state.metrics.read() ?? null,
  });
}

// POST is the only dispatcher: seed once, workers maintain metrics.
export async function POST() {
  seedPromise ??= getIncidentsApi().client.seedIncidents();
  return NextResponse.json({ seeded: true, ms: await seedPromise });
}`;

const RECORD = `// src/app/api/incidents/[id]/route.ts — indexed record read, no dispatch
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { memory } = getIncidentsApi();
  const id = Number((await ctx.params).id);
  const conn = memory.lists.incidents;
  if (!Number.isInteger(id) || id < 0 || id >= conn.recordCount)
    return NextResponse.json({ error: 'incident not found' }, { status: 404 });
  // recordCount is the declared CAPACITY — a fixed-width buffer can't tell
  // written rows from zeroed ones, so refuse reads until the seed lands.
  if (memory.signals.seedProgress.read() < 100)
    return NextResponse.json({ error: 'seed not complete' }, { status: 503 });
  return NextResponse.json(conn.readAt(id, {} as Incident));
}`;

export function NextjsReadModel() {
  return (
    <article>
      <h1>Next.js — read-model API</h1>
      <p className="lead">
        The strongest server-side pattern atoll adds to Next.js: workers own
        writes into a large shared-memory dataset while route handlers read
        it <em>directly</em> — turning hot GETs into indexed memory reads
        instead of dispatches, DB hits, or cache lookups.
      </p>

      <h2>Why it&apos;s different</h2>
      <p>
        Next route handlers share nothing between invocations except module
        scope — and module scope on the API thread is exactly where the
        shared buffer lives. A worker pool keeps a 1M-record incidents list
        seeded and its aggregate metrics maintained; every read endpoint
        (stats, single record, filtered page) is a memory read on the same
        thread that already parsed the request. Compare: an ORM call is a
        network round-trip, and dispatching &ldquo;read row N&rdquo; to a
        worker serializes the record through <code>postMessage</code>.{' '}
        <code>readAt</code> is neither — it&apos;s a typed-array view over
        bytes already in the process.
      </p>
      <p>
        Note the <code>getIncidentsApi().memory</code> reads: Next can
        evaluate a contract module in more than one bundle graph, and only
        the instance the pool bound is readable on this thread — routes go
        through the getter rather than importing the contract directly.
      </p>

      <h2>Wiring</h2>
      <CodeBlock code={POOL} file="api/incidents/pool.ts" />
      <p>
        The worker entry is two lines — the Node shim plus the package&apos;s
        <code>defineWorker</code> module, which registers{' '}
        <code>seedIncidents</code>/<code>queryIncidents</code>/
        <code>computeMetrics</code>:
      </p>
      <CodeBlock
        code={`// src/app/api/incidents/incidents.worker.ts
import '@atolljs/node/shim';
import '@atolljs/incidents/worker/incidents.worker';`}
        file="api/incidents/incidents.worker.ts"
      />

      <h2>Read endpoints</h2>
      <CodeBlock code={STATS} file="api/incidents/route.ts" />
      <CodeBlock code={RECORD} file="api/incidents/[id]/route.ts" />

      <h2>Fit</h2>
      <p>
        Dashboards, leaderboards, feature flags, session state, read-heavy
        reference data — anywhere reads dwarf writes and the dataset fits a
        fixed-width buffer. Writes stay on workers (task dispatch or{' '}
        <a href={docHref('fw-nextjs-server/jobs')}>queue drain</a>), so consistency is
        &ldquo;eventually visible&rdquo; at memory speed. Seed at boot via{' '}
        <a href={docHref('fw-nextjs-server/warmup')}>instrumentation</a> so the first
        request doesn&apos;t pay it.
      </p>
      <p>
        Runnable source: <code>examples/nextjs/src/app/api/incidents/</code>{' '}
        — the same <code>@atolljs/incidents</code> contract the browser demo
        binds client-side.
      </p>
    </article>
  );
}
