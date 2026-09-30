/**
 * Functional test for /api/incidents — same pattern as apiJobs.test.ts: real
 * node:worker_threads pool via a plain-JS protocol fixture (vitest can't
 * bundle the .ts worker entry). ATOLL_INCIDENTS_WORKER points pool.ts at the
 * incidents fixture, which handles the flat wire ids ('seedIncidents',
 * 'computeMetrics') by writing directly into the shared buffer's contract
 * layout.
 *
 * NOTE on [id]: `lists.incidents` is a fixed-capacity list — `recordCount`
 * is the DECLARED 1,000,000, not a seeded-row count, and a fixed-width
 * buffer can't distinguish a written row from a zeroed one. The route
 * therefore gates on seedProgress: before the seed completes every id
 * answers 503; non-integer/negative/out-of-range ids 404 regardless.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

process.env.ATOLL_INCIDENTS_WORKER = fileURLToPath(
  new URL('../../../test/fixtures/incidentsProtocol.worker.mjs', import.meta.url)
);

const { GET, POST } = await import('../src/app/api/incidents/route');
const { GET: GET_BY_ID } = await import('../src/app/api/incidents/[id]/route');
const poolHolder = globalThis as { __atollIncidents?: { pool: { terminate(): void } } };

afterAll(() => {
  poolHolder.__atollIncidents?.pool.terminate();
  delete poolHolder.__atollIncidents;
});

const getById = (id: string) =>
  GET_BY_ID(new Request(`http://localhost/api/incidents/${id}`), {
    params: Promise.resolve({ id }),
  });

describe('/api/incidents routes', () => {
  it('GET reports an unseeded store before POST runs', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    // signals.seedProgress reads 0; state.metrics' written flag is clear → null.
    expect(json).toEqual({ seedProgress: 0, metrics: null });
  });

  it('GET /:id 404s bad ids and 503s valid ids before the seed completes', async () => {
    // Invalid ids 404 on the capacity bounds check regardless of seed state.
    for (const bad of ['abc', '-1', '1.5', '1000000']) {
      const res = await getById(bad);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'incident not found' });
    }

    // recordCount === 1,000,000 is capacity, not seeded rows — record 0 is
    // in-range but unwritten, so the route refuses it until progress=100.
    const unseeded = await getById('0');
    expect(unseeded.status).toBe(503);
    expect(await unseeded.json()).toEqual({ error: 'seed not complete' });
  });

  it('POST dispatches the seed task; the worker writes progress to shared memory', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.seeded).toBe(true);
    expect(json.ms).toBeTypeOf('number');

    // The chained computeMetrics() is fire-and-forget — poll until the
    // worker-side write to state.metrics lands in the shared buffer.
    await vi.waitFor(async () => {
      const json = await (await GET()).json();
      expect(json.seedProgress).toBe(100);
      expect(json.metrics).toMatchObject({ total: 1_000_000, open: 1_000_000 });
    });
  });

  it('POST is idempotent per process — repeat calls join the settled dispatch', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.seeded).toBe(true);
    expect(json.ms).toBeTypeOf('number');
  });

  it('GET /:id serves the record once the seed completes', async () => {
    // The fixture doesn't populate record fields — it flips seedProgress —
    // so the read comes back 200 with the contract's field shape (zeroed
    // values are honest buffer contents post-seed).
    const res = await getById('0');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ id: 0, site: '' });
  });
});
