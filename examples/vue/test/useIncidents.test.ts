/**
 * Functional test: the vue example's composable driving the real mesh in-process.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
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

let useIncidents: typeof import('../src/useIncidents').useIncidents;
beforeAll(async () => {
  ({ useIncidents } = await import('../src/useIncidents'));
});

describe('useIncidents (vue example)', () => {
  it('seeds, reports progress, and serves table pages', async () => {
    const scope = effectScope();
    const d = scope.run(() => useIncidents(ref(QUERY)))!;
    await vi.waitFor(() => expect(d.ready.value).toBe(true), { timeout: 20_000 });
    // seedProgress emits asynchronously via the shared version counter —
    // the task settles before the final emit lands.
    await vi.waitFor(() => expect(d.seedProgress.value).toBe(100));
    await vi.waitFor(() => {
      expect(d.page.value?.rows).toHaveLength(25);
      expect(d.metrics.value?.critical).toBeGreaterThan(0);
    });
    scope.stop();
  });
});
