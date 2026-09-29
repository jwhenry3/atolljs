/**
 * Functional test for /api/Atoll — invokes the route handlers directly (they're
 * plain Request→Response functions) against a REAL node:worker_threads pool.
 * ATOLL_DIGEST_WORKER points createNodePool at a plain-JS fixture worker because
 * nothing under vitest bundles atoll.worker.ts the way webpack/turbopack does.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

process.env.ATOLL_DIGEST_WORKER = fileURLToPath(
  new URL('../../../test/fixtures/atollProtocol.worker.mjs', import.meta.url)
);

const { GET, POST } = await import('../src/app/api/atoll/route');
const poolHolder = globalThis as { __atollDigestPool?: { terminate(): void } };

afterAll(() => {
  poolHolder.__atollDigestPool?.terminate();
  delete poolHolder.__atollDigestPool;
});

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/atoll', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

describe('/api/atoll route', () => {
  it('POST dispatches the hash task to a worker thread', async () => {
    const res = await post({ input: 'atoll', rounds: 5000 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      rounds: 5000,
      jobsDone: 1,
    });
    expect(json.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(json.ms).toBeGreaterThan(0);
  });

  it('GET reads the shared counter without dispatching', async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.jobsDone).toBe(1); // accumulated by the worker-side write
  });

  it('accumulates across the 2-worker pool round-robin', async () => {
    await post({ input: 'a', rounds: 1000 });
    await post({ input: 'b', rounds: 1000 });
    const json = await (await GET()).json();
    expect(json.jobsDone).toBe(3);
  });
});
