import { NextResponse } from 'next/server';
import { Worker } from 'node:worker_threads';
import { createNodePool, createNodeWorker } from '@atolljs/node';
import { digestMemory, HashDigest } from './digest.contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The atoll on the server: a WorkerPool of node:worker_threads threads bound
 * to a shared buffer. createWorker wraps `new Worker(new URL(...))` — the
 * bundler (webpack/turbopack) detects the pattern, compiles the worker entry
 * as its own chunk, and rewrites the URL to the emitted file.
 *
 * Module-scope singleton via globalThis so dev-mode HMR re-evaluation reuses
 * the pool instead of leaking worker threads per hot reload.
 */
const createPool = () =>
  createNodePool({
    sharedMemory: digestMemory,
    poolSize: 2,
    tasks: { hash: HashDigest },
    // ATOLL_DIGEST_WORKER escapes the bundler for plain-Node runs (tests,
    // non-Next deployments) where the URL isn't rewritten to a bundled chunk.
    createWorker: () =>
      createNodeWorker(
        process.env.ATOLL_DIGEST_WORKER
          ? new Worker(process.env.ATOLL_DIGEST_WORKER)
          : new Worker(new URL('./atoll.worker.ts', import.meta.url)),
      ),
  });
type DigestPool = ReturnType<typeof createPool>;

const getPool = (): DigestPool => {
  const g = globalThis as { __atollDigestPool?: DigestPool };
  return (g.__atollDigestPool ??= createPool());
};

/** POST /api/atoll {input, rounds} → the hash task, executed on a worker. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await getPool().hash(body?.input, body?.rounds));
}

/** GET /api/atoll → the shared counter, read directly on the API thread. */
export async function GET() {
  return NextResponse.json({ jobsDone: digestMemory.jobsDone.read() });
}
