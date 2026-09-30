import { NextResponse } from 'next/server';
import type { Incident } from '@atolljs/incidents';
import { getIncidentsApi } from '../pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/incidents/:id — a single record read straight out of the shared
 * buffer. Fixed-width records mean this is an indexed memory read on the API
 * thread: no worker dispatch, no serialization.
 *
 * `recordCount` is the declared list CAPACITY, not a seeded-row count — a
 * fixed-width buffer can't distinguish written rows from zeroed ones, so
 * validity is gated on seedProgress: before seeding completes, every id is
 * potentially an unwritten row and the route answers 503.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { memory } = getIncidentsApi();
  const id = Number((await ctx.params).id);
  const conn = memory.lists.incidents;
  if (!Number.isInteger(id) || id < 0 || id >= conn.recordCount) {
    return NextResponse.json({ error: 'incident not found' }, { status: 404 });
  }
  if (memory.signals.seedProgress.read() < 100) {
    return NextResponse.json({ error: 'seed not complete' }, { status: 503 });
  }
  return NextResponse.json(conn.readAt(id, {} as Incident));
}
