import { CodeBlock } from '../components/CodeBlock';

const CONTRACT = `// src/app/api/jobs/jobs.contract.ts — counters all routes share
import { z } from 'zod';
import { defineSharedMemory, field, type TaskContract } from '@atolljs/core';

export const jobsMemory = defineSharedMemory({
  queued: field.number(),
  completed: field.number(),
  failed: field.number(),
  lastMs: field.number(),
});

export const ProcessJob: TaskContract<[id: number, workMs?: number], JobResult> = {
  taskId: 'jobs.process',
  resultSchema: jobResult,
};`;

const ROUTE = `// src/app/api/jobs/route.ts — enqueue on the API thread, drain in workers
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let nextId = 0;

// POST /api/jobs {"count": N, "workMs"?: number} — returns immediately;
// the pool queues dispatches internally when saturated.
export async function POST(req: Request) {
  const { count = 1, workMs = 50 } = await req.json().catch(() => ({}));
  const { pool, memory } = getJobs();
  for (let i = 0; i < Math.min(1000, count); i++) {
    memory.queued.write(memory.queued.read() + 1);
    void pool.process(nextId++, workMs)
      .catch(() => memory.failed.write(memory.failed.read() + 1));
  }
  return NextResponse.json({ accepted: count, queued: memory.queued.read() });
}

// GET /api/jobs — progress read straight off the buffer. No dispatch.
export async function GET() {
  const { memory } = getJobs();
  const queued = memory.queued.read();
  const completed = memory.completed.read();
  return NextResponse.json({ queued, completed, failed: memory.failed.read(),
    inFlight: queued - completed - memory.failed.read(),
    lastMs: memory.lastMs.read() });
}`;

const WORKER = `// src/app/api/jobs/jobs.worker.ts — each completion is a memory write
import '@atolljs/node/shim';
import '@atolljs/core/worker/workerBootstrap';
import { TaskRegistry } from '@atolljs/core';
import { jobsMemory, ProcessJob } from './jobs.contract';

TaskRegistry.register(ProcessJob, (id, workMs = 50) => {
  const t0 = performance.now();
  let acc = 0;
  while (performance.now() - t0 < workMs) acc += Math.sqrt(acc);
  const completed = jobsMemory.completed.read() + 1;
  jobsMemory.completed.write(completed);
  jobsMemory.lastMs.write(performance.now() - t0);
  return { id, ms: performance.now() - t0, completed };
});`;

export function NextjsJobs() {
  return (
    <article>
      <h1>Next.js — job queue</h1>
      <p className="lead">
        A background job queue with zero external infrastructure: POST
        enqueues work, the pool drains it on worker threads, and a progress
        endpoint reads counters straight out of shared memory — no Redis, no
        database polling, no <code>postMessage</code> per status update.
      </p>

      <h2>The shape</h2>
      <p>
        Three moving parts, all inside the Next.js server bundle: a shared
        counter contract, a pooled <code>process</code> task, and a route
        handler that writes <code>queued</code> before fire-and-forget
        dispatch. Because the queue state <em>is</em> shared memory, the GET
        handler is a pure read — it never touches a worker.
      </p>
      <CodeBlock code={CONTRACT} file="api/jobs/jobs.contract.ts" />
      <CodeBlock code={ROUTE} file="api/jobs/route.ts" />
      <CodeBlock code={WORKER} file="api/jobs/jobs.worker.ts" />

      <h2>Why not just await</h2>
      <p>
        Awaiting a batch in POST couples response latency to total work time
        and invites platform timeouts. Writing the counter and releasing the
        dispatch means the handler answers in microseconds while workers
        drain at their own pace — the client polls{' '}
        <code>GET /api/jobs</code> (or binds the same fields with{' '}
        <code>useSharedValue</code> in a client component) for live progress.
      </p>

      <h2>Where it runs</h2>
      <p>
        Same contract as every server-side use case:{' '}
        <code>export const runtime = &apos;nodejs&apos;</code>, a globalThis-held
        pool (see <a href="#/fw-nextjs-server">Next.js server</a>), and a
        long-lived process. One subtlety the example demonstrates: Next may
        evaluate a contract module in more than one bundle graph
        (instrumentation&apos;s import graph vs the route&apos;s), so handlers
        read memory through <code>getJobs().memory</code> — the instance the
        pool actually bound — instead of a second <code>jobsMemory</code>{' '}
        import that could be unbound on this thread. On serverless the pool — and the queue state —
        dies with the invocation, so this pattern targets self-hosted{' '}
        <code>next start</code> or standalone output, not per-request
        functions.
      </p>
      <p>
        Runnable source: <code>examples/nextjs/src/app/api/jobs/</code>,
        tested by <code>test/apiJobs.test.ts</code> against a real
        worker_threads pool.
      </p>
    </article>
  );
}
