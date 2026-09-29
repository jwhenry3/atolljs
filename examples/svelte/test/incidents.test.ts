/**
 * Functional test: the svelte example's createIncidents driving the real atoll
 * in-process. `inRoot` supplies the rune effect root the example expects.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/sdk/testing/inProcessWorker';
import { inRoot } from './root.svelte.js';
import type { QueryArgs } from '@atolljs/core/incidents';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('@atolljs/core/incidents/worker/incidents.worker'),
];

const QUERY: QueryArgs = {
  offset: 0, limit: 25, sortBy: null, sortDesc: false,
  severity: null, status: null, region: null, service: null, search: '',
};

let createIncidents: typeof import('../src/incidents.svelte').createIncidents;
beforeAll(async () => {
  ({ createIncidents } = await import('../src/incidents.svelte'));
});

describe('createIncidents (svelte example)', () => {
  it('seeds, reports progress, and serves table pages', async () => {
    const { value: d, destroy } = inRoot(() => createIncidents(() => QUERY));
    await vi.waitFor(() => expect(d.ready).toBe(true), { timeout: 20_000 });
    // seedProgress emits asynchronously via the shared version counter —
    // the task settles before the final emit lands.
    await vi.waitFor(() => expect(d.seedProgress).toBe(100));
    await vi.waitFor(() => {
      expect(d.page?.rows).toHaveLength(25);
      expect(d.metrics?.critical).toBeGreaterThan(0);
    });
    destroy();
  });
});
