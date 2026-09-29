import { NextResponse } from 'next/server';
import { getJobs } from './pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let nextId = 0;

/**
 * POST /api/jobs {"count": N, "workMs"?: number} — enqueue N jobs and return
 * immediately. The pool queues dispatches internally when saturated, so this
 * handler never blocks on the work itself. Memory reads/writes go through
 * `getJobs().memory` — the instance the pool bound on this thread (Next may
 * evaluate the contract module again in a different graph).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const count = Math.min(1000, Math.max(1, Number(body?.count) || 1));
  const workMs = Number(body?.workMs) || 50;
  const { pool, memory } = getJobs();
  const dispatches: Promise<unknown>[] = [];
  for (let i = 0; i < count; i++) {
    memory.queued.write(memory.queued.read() + 1);
    dispatches.push(
      pool.process(nextId++, workMs).catch(() => {
        memory.failed.write(memory.failed.read() + 1);
      }),
    );
  }
  // Track the batch so rejections are handled, but respond now — the client
  // polls GET /api/jobs for progress.
  void Promise.allSettled(dispatches);
  return NextResponse.json({ accepted: count, queued: memory.queued.read() });
}

/**
 * GET /api/jobs — queue progress read straight out of shared memory on the
 * API thread. No dispatch, no postMessage.
 */
export async function GET() {
  const { memory } = getJobs();
  const queued = memory.queued.read();
  const completed = memory.completed.read();
  return NextResponse.json({
    queued,
    completed,
    failed: memory.failed.read(),
    inFlight: queued - completed - memory.failed.read(),
    lastMs: memory.lastMs.read(),
  });
}
