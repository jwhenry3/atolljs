import { describe, expect, it } from 'vitest';
import { incidentRowSchema, incidentsMemory } from '../src/contract/memory.contracts';
import { queryArgsSchema, queryIncidents } from '../src/service/queryIncidents';
import { computeMetrics } from '../src/service/computeMetrics';

// Contract schemas are atoll-minted — they carry the zod-style `_zod.def`
// layout descriptors and a `.parse`, without being instances of zod classes.
const isSchema = (v: unknown) =>
  typeof v === 'object' && v !== null &&
  typeof (v as { parse?: unknown }).parse === 'function' &&
  typeof (v as { _zod?: { def?: unknown } })._zod?.def === 'object';

const validQuery = {
  offset: 0, limit: 50, sortBy: null, sortDesc: false,
  severity: null, status: null, region: null, service: null, search: '',
};

describe('incidents wire schemas', () => {
  it('queryIncidents validates args against the zod schema', () => {
    expect(() => queryArgsSchema.parse(validQuery)).not.toThrow();
    expect(() => queryArgsSchema.parse({ ...validQuery, limit: 'many' })).toThrow();
    const argsSchema = queryIncidents.def.argsSchema!;
    expect(() => argsSchema.parse([validQuery])).not.toThrow();
    expect(() => argsSchema.parse([{ bad: true }])).toThrow();
  });

  it('rejects metric results missing required aggregates', () => {
    expect(() =>
      computeMetrics.def.resultSchema!.parse({ total: 1 })
    ).toThrow();
  });
});

describe('incidentsMemory', () => {
  it('declares a 1M-record list plus metrics and seedProgress', () => {
    expect(incidentsMemory.totalBytes).toBeGreaterThan(30_000_000);
  });

  it('groups fields by intent — lists / state / signals', () => {
    const { spec, schemas } = incidentsMemory;
    expect(spec.lists.incidents.kind).toBe('list');
    expect(spec.state.metrics.kind).toBe('object');
    expect(spec.signals.seedProgress.kind).toBe('number');
    // metrics declares no maxBytes — its width derives from the reef schema:
    // 8 f64 members → 64-byte record + 8-byte header
    expect(spec.state.metrics.recordSize).toBe(64);
    expect(spec.state.metrics.byteLength).toBe(72);
    // schemas nest where the spec nests them
    expect(isSchema(schemas.lists.incidents)).toBe(true);
    expect(isSchema(schemas.state.metrics)).toBe(true);
    expect(isSchema(schemas.signals.seedProgress)).toBe(true);
  });

  it('carries the inline spec back out via .spec', () => {
    const spec = incidentsMemory.spec.lists.incidents;
    expect(spec.count).toBe(1_000_000);
    // `schema` is the declared reef.object record schema; `layout`
    // holds the compiled binary spec its members map to.
    expect(isSchema(spec.schema.shape.site)).toBe(true);
    expect(spec.layout.site).toEqual({ string: 10 });
    expect(spec.layout.id).toBe('u32');      // reef.u32() → u32
    expect(spec.layout.alarms).toBe('u16');  // reef.u16() → u16
    expect(spec.layout.severity).toBe('u8'); // reef.int(0,3) → u8
  });

  it('re-exports field schemas via .schemas', () => {
    const { schemas } = incidentsMemory;
    // list fields get a derived record schema
    const row = schemas.lists.incidents.parse({
      id: 1, openedAt: 2, durationMin: 3, customers: 4, alarms: 5,
      severity: 0, status: 1, region: 2, service: 3, site: 'A1',
    });
    expect(row.id).toBe(1);
    // declared domain bounds survive — severity is 0..3, not the raw u8 range
    expect(() => schemas.lists.incidents.parse({
      id: 1, openedAt: 2, durationMin: 3, customers: 4, alarms: 5,
      severity: 9, status: 1, region: 2, service: 3, site: 'A1',
    })).toThrow();
    // declared object schema parses metrics
    expect(schemas.state.metrics.parse({
      total: 1, open: 1, acknowledged: 0, resolved: 0,
      critical: 0, customersAffected: 10, avgDurationMin: 5, scanMs: 1,
    }).total).toBe(1);
    // scalars get derived schemas
    expect(schemas.signals.seedProgress.parse(0.5)).toBe(0.5);
    expect(() => schemas.signals.seedProgress.parse('half')).toThrow();
  });
});
