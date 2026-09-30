import { CodeBlock } from '../components/CodeBlock';
import { PkgLink } from '../components/PkgLink';
import { docHref } from '../link';
import { FRAMEWORKS } from '../frameworks';

// Two pages share this file: Nextjs (Frontend — the @atolljs/nextjs hooks
// for client components) and NextjsServer (Backend — route-handler pools via
// @atolljs/node). Nextjs reuses the generic framework doc's fields
// (install/usage/apis/notes) and adds the sections that don't fit the
// template: client-boundary guidance and deployment. Next.js is
// server-rendered, so there is no embedded live demo — the frame could only
// fill while a Node server is listening, which a static docs host never has.
const fw = FRAMEWORKS.find((f) => f.id === 'nextjs')!;

const USAGE_ROUTE = `// src/app/api/atoll/route.ts — route handlers run on Node,
// so @atolljs/node works inside them: a pool of node:worker_threads
// workers sharing one buffer with the API thread.
import { NextResponse } from 'next/server';
import { Worker } from 'node:worker_threads';
import { createNodePool, createNodeWorker } from '@atolljs/node';
import { digestMemory, HashDigest } from './digest.contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Module-scope singleton via globalThis — dev-mode HMR re-evaluates the
// module; without it every hot reload would leak worker threads.
const createPool = () =>
  createNodePool({
    sharedMemory: digestMemory,
    poolSize: 2,
    tasks: { hash: HashDigest },
    // webpack/turbopack detect new Worker(new URL(...)) and emit the
    // worker entry as its own chunk — the factory points at TS source.
    createWorker: () => createNodeWorker(
      new Worker(new URL('./atoll.worker.ts', import.meta.url)),
    ),
  });
type DigestPool = ReturnType<typeof createPool>;

const getPool = (): DigestPool => {
  const g = globalThis as { __atollDigestPool?: DigestPool };
  return (g.__atollDigestPool ??= createPool());
};

export async function POST(req: Request) {           // CPU-bound work, off the
  const body = await req.json().catch(() => ({}));   // request thread
  return NextResponse.json(await getPool().hash(body?.input, body?.rounds));
}

export async function GET() {   // direct shared-memory read — zero dispatch
  return NextResponse.json({ jobsDone: digestMemory.jobsDone.read() });
}`;

const USAGE_WORKER = `// src/app/api/atoll/atoll.worker.ts — the shim MUST be
// first: it binds self = parentPort before workerBootstrap wires
// INIT_MEMORY / EXECUTE_TASK onto the node:worker_threads MessagePort.
import '@atolljs/node/shim';
import '@atolljs/core/worker/workerBootstrap';
import { TaskRegistry } from '@atolljs/core';
import { createHash } from 'node:crypto';
import { digestMemory, HashDigest } from './digest.contract';

TaskRegistry.register(HashDigest, (input = 'incident-feed', rounds = 50_000) => {
  // chained SHA-256 … then digestMemory.jobsDone.write(…) — the route
  // handler's GET reads it back without touching the pool.
});`;

export function Nextjs() {
  return (
    <article>
      <h1>Next.js</h1>
      <p className="lead">
        <PkgLink name={fw.pkg} /> — the React hooks re-exported for App Router
        client components. The server-side surface —{' '}
        <code>node:worker_threads</code> pools inside route handlers via{' '}
        <code>@atolljs/node</code> — is documented under{' '}
        <a href={docHref('fw-nextjs-server')}>Backend → Next.js</a>.
      </p>

      <h2>Install</h2>
      <CodeBlock code={fw.install} language="bash" />

      <h2>Client components</h2>
      <p>
        Components calling the hooks carry the <code>'use client'</code>{' '}
        directive — that boundary component is the edge;{' '}
        <code>app/page.tsx</code> can stay a server component that just
        renders it. Importing the <code>connectWorker</code> client is
        SSR-safe: the pool spawns lazily on the first method call, never
        during a server render, and field reads return{' '}
        <code>undefined</code> until the contract binds on the client.
      </p>
      <CodeBlock code={fw.usage} file={fw.usageFile} language={fw.usageLanguage} />

      <h2>Binding API</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Export</th><th>Signature</th><th>What it does</th></tr>
        </thead>
        <tbody>
          {fw.apis.map((api) => (
            <tr key={api.name}>
              <td><code>{api.name}</code></td>
              <td><code>{api.signature}</code></td>
              <td>{api.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Deployment</h2>
      <ul>
        <li>
          Next.js needs a <strong>Node runtime</strong> —{' '}
          <code>next start</code>, a Node host, or a platform like Vercel.
          Static file hosts (GitHub Pages, S3) can't run it, which is why the
          Pages deploy mounts every other example but not this one.
        </li>
        <li>
          <code>output: 'export'</code> produces static HTML — client
          components still hydrate and client-side pools still spawn, but
          route handlers are dropped and <code>next.config.ts</code>{' '}
          <code>headers()</code> is not emitted. A shared-memory pool then
          needs the host (or a COI service worker, see Hosting &amp; headers)
          to send COOP/COEP; a message-only pool needs neither.
        </li>
      </ul>

      {fw.notes.length > 0 && (
        <>
          <h2>Notes</h2>
          <ul>
            {fw.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

export function NextjsServer() {
  return (
    <article>
      <h1>Next.js — server workers</h1>
      <p className="lead">
        <code>@atolljs/node</code> inside a Next.js app: route handlers run on
        Node, so a handler can own a real <code>node:worker_threads</code>{' '}
        pool — dispatch CPU-bound tasks without blocking the request thread,
        and read the pool's shared memory directly on the API thread for
        zero-dispatch responses. The client-side hooks are documented under{' '}
        <a href={docHref('fw-nextjs')}>Frontend → Next.js</a>.
      </p>

      <h2>Install</h2>
      <CodeBlock code="npm install @atolljs/core @atolljs/node" language="bash" />

      <h2>Route handler — the pool owner</h2>
      <CodeBlock code={USAGE_ROUTE} file="src/app/api/atoll/route.ts" />
      <CodeBlock code={USAGE_WORKER} file="src/app/api/atoll/atoll.worker.ts" />
      <p>
        The repo's <code>examples/nextjs</code> implements this pattern —
        it exposes <code>POST /api/atoll</code> ({'{"input","rounds"}'} →
        chained SHA-256 on a worker) and <code>GET /api/atoll</code> (a direct
        shared-memory read of <code>jobsDone</code>); see{' '}
        <code>examples/nextjs/src/app/api/atoll/</code>. Run it locally with{' '}
        <code>npm run dev</code> in the example (or{' '}
        <code>npm run serve:all</code> from the repo root) — there is no
        embedded demo here because a static docs host has no Node runtime.
      </p>

      <h2>Going further</h2>
      <p>
        The example builds three more use cases on this pattern, each with a
        dedicated page: a{' '}
        <a href={docHref('fw-nextjs-server/jobs')}>job queue</a> whose progress
        counters live in shared memory, a{' '}
        <a href={docHref('fw-nextjs-server/read-model')}>read-model API</a> serving a
        1M-record buffer with zero dispatch,{' '}
        <a href={docHref('fw-nextjs-server/warmup')}>boot warmup</a> via Next&apos;s
        instrumentation hook, and the{' '}
        <a href={docHref('fw-nextjs-server/custom-server')}>custom-server</a> topology
        for clustering and WebSockets.
      </p>

      <h2>Notes</h2>
      <ul>
        <li>Requires the <code>nodejs</code> runtime (the default for route handlers) — <code>output: 'export'</code> drops handlers entirely, so the pool needs a Node host or <code>next start</code>.</li>
        <li>Hold the pool in a module-scope singleton on <code>globalThis</code> — dev-mode HMR re-evaluates the module, and without it every hot reload leaks worker threads.</li>
        <li>No COOP/COEP needed — Node always allows <code>SharedArrayBuffer</code>.</li>
      </ul>
    </article>
  );
}
