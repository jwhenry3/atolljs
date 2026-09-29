import { CodeBlock } from '../components/CodeBlock';

const REGISTER = `// src/instrumentation.ts — Next.js runs register() once at server boot
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getDigest } = await import('./app/api/atoll/pool');
  const { getJobs } = await import('./app/api/jobs/pool');
  const { getIncidentsApi } = await import('./app/api/incidents/pool');
  getDigest();
  getJobs();
  // Kick the expensive part: 1M records seed on workers during startup,
  // then a metrics recompute so the read-model endpoints are fully warm.
  void getIncidentsApi().client.seedIncidents()
    .then(() => getIncidentsApi().client.computeMetrics())
    .catch(console.error);
}`;

const CLEANUP = `// Tests own their pool lifecycle — terminate so vitest can exit.
const holder = globalThis as { __atollJobs?: { pool: { terminate(): void } } };
afterAll(() => {
  holder.__atollJobs?.pool.terminate();
  delete holder.__atollJobs;
});`;

export function NextjsWarmup() {
  return (
    <article>
      <h1>Next.js — boot warmup</h1>
      <p className="lead">
        Lazy pools are right for development, but production cold starts
        shouldn&apos;t spawn workers and seed a million records inside the
        first request. Next.js&apos;s <code>instrumentation.ts</code> hook is
        the answer: <code>register()</code> runs once when the Node.js
        runtime boots, before the server accepts traffic.
      </p>

      <h2>register()</h2>
      <CodeBlock code={REGISTER} file="src/instrumentation.ts" />
      <p>
        Three details matter: the <code>NEXT_RUNTIME === &apos;nodejs&apos;</code>{' '}
        guard keeps it out of the edge runtime; the <em>dynamic</em> imports
        keep <code>node:worker_threads</code> out of bundle graphs that
        can&apos;t support it; and the seed is fired without await — boot
        doesn&apos;t block on it, it just starts early. Because the seed is
        dispatched at boot,{' '}
        <a href="#/fw-nextjs-server/read-model">read-model endpoints</a>{' '}
        report live <code>seedProgress</code> during warmup and are fully
        warm before most traffic arrives.
      </p>

      <h2>Lifecycle</h2>
      <p>
        Pool identity lives on <code>globalThis</code> — in dev, module
        reloads re-run the getters but return the same pool instead of
        re-spawning workers on every HMR cycle. In production the pool
        outlives every request and dies with the process; for tests,
        terminate explicitly rather than leaking threads:
      </p>
      <CodeBlock code={CLEANUP} file="test/apiJobs.test.ts" />
      <p>
        <code>pool.terminate()</code> also exists for graceful shutdown in a
        custom server — see{' '}
        <a href="#/fw-nextjs-server/custom-server">custom server</a> for the
        production topology that owns the process lifecycle.
      </p>

      <h2>What to warm</h2>
      <p>
        Anything whose first-call cost matters: worker spawn (~tens of ms
        each), shared-buffer initialization, and seed/refresh dispatches.
        Warming is cheap insurance under load — a cold pool under a request
        burst spawns while queuing requests, compounding latency exactly
        when you can least afford it.
      </p>
    </article>
  );
}
