import { describe, expect, it } from 'vitest';
import {
  incidentRowSchema,
  incidentsMemory,
  queryArgsSchema,
} from '../src/contract/memory.contracts';
import { ComputeMetrics, QueryIncidents, SeedIncidents } from '../src/contract/task.contracts';
import { incidentsTasks } from '../src/pool';

const validQuery = {
  offset: 0, limit: 50, sortBy: null, sortDesc: false,
  severity: null, status: null, region: null, service: null, search: '',
};

describe('task contracts', () => {
  it('expose stable taskIds and validate their shapes', () => {
    expect(SeedIncidents.taskId).toBe('inc-seed');
    expect(QueryIncidents.taskId).toBe('inc-query');
    expect(ComputeMetrics.taskId).toBe('inc-metrics');
  });

  it('queryIncidents validates args against the zod schema', () => {
    expect(() => queryArgsSchema.parse(validQuery)).not.toThrow();
    expect(() => queryArgsSchema.parse({ ...validQuery, limit: 'many' })).toThrow();
    expect(() => QueryIncidents.argsSchema!.parse([validQuery])).not.toThrow();
    expect(() => QueryIncidents.argsSchema!.parse([{ bad: true }])).toThrow();
  });

  it('rejects metric results missing required aggregates', () => {
    expect(() =>
      ComputeMetrics.resultSchema!.parse({ total: 1 })
    ).toThrow();
  });
});

describe('incidentsMemory', () => {
  it('declares a 1M-record struct plus metrics and seedProgress', () => {
    expect(incidentsMemory.totalBytes).toBeGreaterThan(30_000_000);
  });
});

describe('incidentsTasks', () => {
  it('maps method names to their contracts', () => {
    expect(incidentsTasks.seedIncidents).toBe(SeedIncidents);
    expect(incidentsTasks.queryIncidents).toBe(QueryIncidents);
    expect(incidentsTasks.computeMetrics).toBe(ComputeMetrics);
  });
});
