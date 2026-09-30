import { NextResponse } from 'next/server';
import { getIncidentsApi } from './pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One seed per process — instrumentation.ts kicks this at boot; POST is the
// manual retry. Repeat calls join the in-flight (or settled) dispatch, which
// chains a metrics recompute after the seed (same as initIncidents). A
// REJECTED promise is cleared so a later POST can retry.
let seedPromise: Promise<number> | null = null;
const seed = () =>
  getIncidentsApi()
    .client.seedIncidents()
    .then(async (ms) => {
      void getIncidentsApi().client.computeMetrics().catch(console.error);
      return ms;
    });

/**
 * GET /api/incidents — seed progress + aggregate metrics read directly from
 * shared memory on the API thread. Workers recompute `state.metrics` after
 * writes; this handler never dispatches or postMessages. Reads go through
 * `getIncidentsApi().memory` — the instance the pool bound (the contract
 * module may be evaluated again in a separate bundle graph).
 */
export async function GET() {
  const { memory } = getIncidentsApi();
  return NextResponse.json({
    seedProgress: memory.signals.seedProgress.read(),
    metrics: memory.state.metrics.read() ?? null,
  });
}

/** POST /api/incidents — dispatch the seed task (idempotent per process). */
export async function POST() {
  seedPromise ??= seed().catch((err) => {
    seedPromise = null; // failed seed — let the next POST retry
    throw err;
  });
  const ms = await seedPromise;
  return NextResponse.json({ seeded: true, ms });
}
