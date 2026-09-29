import { NextResponse } from 'next/server';
import type { Incident } from '@atolljs/incidents';
import { getIncidentsApi } from '../pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/incidents/:id — a single record read straight out of the shared
 * buffer. Fixed-width records mean this is an indexed memory read on the API
 * thread: no worker dispatch, no serialization.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  // Read via the pool-bound memory instance — the contract module can be
  // evaluated twice under Next's separate bundle graphs.
  const conn = getIncidentsApi().memory.lists.incidents;
  if (!Number.isInteger(id) || id < 0 || id >= conn.recordCount) {
    return NextResponse.json({ error: 'incident not found' }, { status: 404 });
  }
  return NextResponse.json(conn.readAt(id, {} as Incident));
}
