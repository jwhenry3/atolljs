/**
 * Functional test: the solid example's createIncidents driving the real mesh
 * in-process.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { InProcessWorker } from '@jwhenry123/mesh/sdk/testing/inProcessWorker';
import type { QueryArgs } from '@jwhenry123/mesh/incidents';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('@jwhenry123/mesh/incidents/worker/incidents.worker'),
];

const QUERY: QueryArgs = {
  offset: 0, limit: 25, sortBy: null, sortDesc: false,
  severity: null, status: null, region: null, service: null, search: '',
};

let createIncidents: typeof import('../src/incidents').createIncidents;
beforeAll(async () => {
  ({ createIncidents } = await import('../src/incidents'));
});

describe('createIncidents (solid example)', () => {
  it('seeds, reports progress, and serves table pages', async () => {
    let d!: ReturnType<typeof createIncidents>;
    const dispose = createRoot((done) => {
      d = createIncidents(() => QUERY);
      return done;
    });
    await vi.waitFor(() => expect(d.ready()).toBe(true), { timeout: 20_000 });
    // seedProgress emits asynchronously via the shared version counter —
    // the task settles before the final emit lands.
    await vi.waitFor(() => expect(d.seedProgress()).toBe(100));
    await vi.waitFor(() => {
      expect(d.page()?.rows).toHaveLength(25);
      expect(d.metrics()?.critical).toBeGreaterThan(0);
    });
    dispose();
  });
});
