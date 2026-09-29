import { NextResponse } from 'next/server';
import { getDigest } from './pool';

// worker_threads need the Node.js runtime — Edge runtime cannot spawn them.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/atoll {"input": "...", "rounds"?: number} → {hash, rounds, ms, jobsDone} */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await getDigest().pool.hash(body?.input, body?.rounds));
}

/**
 * GET /api/atoll → {jobsDone} — read straight out of shared memory. Read via
 * `getDigest().memory`: the pool-bound instance, not a second contract
 * evaluation that could be unbound on this thread.
 */
export async function GET() {
  return NextResponse.json({ jobsDone: getDigest().memory.jobsDone.read() });
}
