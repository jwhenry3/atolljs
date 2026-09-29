// @vitest-environment happy-dom
/**
 * Functional test: the example's data layer driving the real mesh — pool,
 * shared buffer, and the actual worker entry handlers — minus the OS thread
 * (InProcessWorker runs the protocol in-process).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@jwhenry123/mesh/sdk/testing/inProcessWorker';
import type { QueryArgs } from '@jwhenry123/mesh/incidents';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
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
  // Imported after the Worker stub — module side effect constructs the pool.
  ({ useIncidents } = await import('../src/useIncidents'));
});

describe('useIncidents (react example)', () => {
  it('seeds via the pool, streams progress, and serves table pages', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    function App() {
      const d = useIncidents(QUERY);
      return (
        <div>
          <span data-t="ready">{String(d.ready)}</span>
          <span data-t="progress">{d.seedProgress}</span>
          <span data-t="rows">{d.page?.rows.length ?? -1}</span>
          <span data-t="critical">{d.metrics?.critical ?? -1}</span>
        </div>
      );
    }
    act(() => root.render(<App />));

    await vi.waitFor(() =>
      expect(container.querySelector('[data-t=ready]')!.textContent).toBe('true')
    );
    await vi.waitFor(() =>
      expect(container.querySelector('[data-t=progress]')!.textContent).toBe('100')
    );
    await vi.waitFor(() => {
      expect(container.querySelector('[data-t=rows]')!.textContent).toBe('25');
      expect(Number(container.querySelector('[data-t=critical]')!.textContent)).toBeGreaterThan(0);
    });
    act(() => root.unmount());
  });
});
