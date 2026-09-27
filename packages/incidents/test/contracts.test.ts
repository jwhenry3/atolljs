import { describe, expect, it } from 'vitest';
import {
  incidentRowSchema,
  incidentsMemory,
  queryArgsSchema,
} from '../src/contract/memory.contracts';
import { incidentsService } from '../src/contract/incidents.service';
import { incidentsTasks } from '../src/pool';

const validQuery = {
  offset: 0, limit: 50, sortBy: null, sortDesc: false,
  severity: null, status: null, region: null, service: null, search: '',
};

describe('incidentsService', () => {
  it('derives stable wire ids from the service name', () => {
    expect(incidentsService.name).toBe('incidents');
    expect(incidentsService.tasks.seedIncidents.taskId).toBe('incidents.seedIncidents');
    expect(incidentsService.tasks.queryIncidents.taskId).toBe('incidents.queryIncidents');
    expect(incidentsService.tasks.computeMetrics.taskId).toBe('incidents.computeMetrics');
  });

  it('queryIncidents validates args against the zod schema', () => {
    expect(() => queryArgsSchema.parse(validQuery)).not.toThrow();
    expect(() => queryArgsSchema.parse({ ...validQuery, limit: 'many' })).toThrow();
    expect(() => incidentsService.tasks.queryIncidents.argsSchema!.parse([validQuery])).not.toThrow();
    expect(() => incidentsService.tasks.queryIncidents.argsSchema!.parse([{ bad: true }])).toThrow();
  });

  it('rejects metric results missing required aggregates', () => {
    expect(() =>
      incidentsService.tasks.computeMetrics.resultSchema!.parse({ total: 1 })
    ).toThrow();
  });
});

describe('incidentsMemory', () => {
  it('declares a 1M-record struct plus metrics and seedProgress', () => {
    expect(incidentsMemory.totalBytes).toBeGreaterThan(30_000_000);
  });
});

describe('incidentsTasks', () => {
  it('is the service contract in TaskMap shape', () => {
    expect(incidentsTasks).toBe(incidentsService.tasks);
  });
});
