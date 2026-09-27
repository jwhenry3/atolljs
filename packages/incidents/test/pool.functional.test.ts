import { afterAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '../../../test/inProcessWorker';

/**
 * Full incidents pipeline, everything real except the OS thread: the pool
 * hands its shared buffer to the in-process worker, which binds the contract
 * and runs the actual seed/query/metrics handlers from incidents.worker.ts.
 */
vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('@jwhenry123/mesh-incidents/worker/incidents.worker'),
];

// Imports must follow the stub — module side effects create the pool lazily.
const { getIncidentsPool, initIncidentsTask, queryIncidentsTask } = await import('../src/pool').then(
  async (pool) => ({
    getIncidentsPool: pool.getIncidentsPool,
    ...(await import('../src/tasks')),
  })
);
const { incidentsMemory } = await import('../src/contract/memory.contracts');

const query = {
  offset: 0, limit: 25, sortBy: 'severity', sortDesc: true,
  severity: null, status: null, region: null, service: null, search: '',
};

describe('incidents pipeline (in-process worker)', () => {
  afterAll(() => getIncidentsPool().terminate());

  it('seeds 1M records on the worker and reports progress via shared memory', async () => {
    const ms = await getIncidentsPool().seedIncidents();
    expect(ms).toBeGreaterThan(0);
    expect(incidentsMemory.seedProgress.read()).toBe(100);
  });

  it('queryIncidents returns a sorted page with real aggregates', async () => {
    const page = await getIncidentsPool().queryIncidents(query);
    expect(page.total).toBe(1_000_000);
    expect(page.filtered).toBe(1_000_000);
    expect(page.rows).toHaveLength(25);
    // severity desc — first rows are critical (3)
    expect(page.rows[0].severity).toBe(3);
    for (let i = 1; i < page.rows.length; i++) {
      expect(page.rows[i].severity).toBeLessThanOrEqual(page.rows[i - 1].severity);
    }
  });

  it('filters by severity and search', async () => {
    const site = 'NYC';
    const page = await getIncidentsPool().queryIncidents({
      ...query, sortBy: null, limit: 10, severity: 3, search: site,
    });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((r) => r.severity === 3 && r.site.startsWith(site))).toBe(true);
    expect(page.filtered).toBeLessThan(page.total);
  });

  it('computeMetrics publishes real aggregates into shared memory', async () => {
    const m = await getIncidentsPool().computeMetrics();
    expect(m.total).toBe(1_000_000);
    expect(m.open + m.acknowledged + m.resolved).toBe(1_000_000);
    // the same object the worker wrote is readable on this thread
    expect(incidentsMemory.metrics.read()).toMatchObject({ total: 1_000_000 });
  });

  it('tasks expose pending/settled state transitions', async () => {
    initIncidentsTask.runOnce();
    await vi.waitFor(() => expect(initIncidentsTask.get().settled).toBe(true));

    queryIncidentsTask.run(query);
    await vi.waitFor(() => expect(queryIncidentsTask.get().settled).toBe(true));
    expect(queryIncidentsTask.get().data?.rows).toHaveLength(25);
  });
});
