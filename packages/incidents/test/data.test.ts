import { describe, expect, it } from 'vitest';
import { CITIES, REGIONS, SERVICES, type Incident } from '../src/contract/memory.contracts';
import { genIncident, mulberry32 } from '../src/service/seedIncidents';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(1337), b = mulberry32(1337);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('produces values in [0, 1)', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('genIncident', () => {
  it('populates every record field with in-range values', () => {
    const rand = mulberry32(7);
    const rec = {} as Incident;
    for (let i = 0; i < 100; i++) {
      const r = genIncident(i, rand, rec);
      expect(r.id).toBe(i);
      expect(r.severity).toBeGreaterThanOrEqual(0);
      expect(r.severity).toBeLessThanOrEqual(3);
      expect(r.status).toBeGreaterThanOrEqual(0);
      expect(r.status).toBeLessThanOrEqual(2);
      expect(r.region).toBeGreaterThanOrEqual(0);
      expect(r.region).toBeLessThan(REGIONS.length);
      expect(r.service).toBeGreaterThanOrEqual(0);
      expect(r.service).toBeLessThan(SERVICES.length);
      expect(r.site).toMatch(/^[A-Z]{3}-\d{4}$/);
      expect(CITIES).toContain(r.site.slice(0, 3));
      expect(r.customers).toBeGreaterThanOrEqual(0);
      expect(r.durationMin).toBeGreaterThanOrEqual(0);
      expect(r.alarms).toBeGreaterThanOrEqual(1);
      expect(r.openedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    }
  });

  it('is deterministic given the same rng sequence', () => {
    const a = genIncident(5, mulberry32(9), {} as Incident);
    const b = genIncident(5, mulberry32(9), {} as Incident);
    // openedAt depends on wall-clock seconds — everything else is seeded
    expect({ ...a, openedAt: 0 }).toEqual({ ...b, openedAt: 0 });
  });
});
