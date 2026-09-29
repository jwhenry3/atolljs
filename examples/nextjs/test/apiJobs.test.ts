/**
 * Functional test for /api/jobs — same pattern as apiAtoll.test.ts: real
 * node:worker_threads pool via the plain-JS protocol fixture (vitest can't
 * bundle the .ts worker entry). Exercises the fire-and-forget queue: POST
 * returns before work finishes, GET reports progress from shared memory.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

process.env.ATOLL_JOBS_WORKER = fileURLToPath(
  new URL('../../../test/fixtures/atollProtocol.worker.mjs', import.meta.url)
);

const { GET, POST } = await import('../src/app/api/jobs/route');
const poolHolder = globalThis as { __atollJobs?: { pool: { terminate(): void } } };

afterAll(() => {
  poolHolder.__atollJobs?.pool.terminate();
  delete poolHolder.__atollJobs;
});

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

describe('/api/jobs route', () => {
  it('POST enqueues and returns without awaiting the work', async () => {
    const res = await post({ count: 3, workMs: 5 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ accepted: 3, queued: 3 });
  });

  it('workers drain the queue; GET reports progress from shared memory', async () => {
    await vi.waitFor(async () => {
      const json = await (await GET()).json();
      expect(json.completed).toBe(3);
    });
    const json = await (await GET()).json();
    expect(json).toMatchObject({ queued: 3, completed: 3, failed: 0, inFlight: 0 });
    expect(json.lastMs).toBeGreaterThan(0);
  });

  it('accumulates across batches', async () => {
    await post({ count: 2, workMs: 5 });
    await vi.waitFor(async () => {
      const json = await (await GET()).json();
      expect(json).toMatchObject({ queued: 5, completed: 5 });
    });
  });
});
