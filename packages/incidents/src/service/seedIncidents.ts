// One task's whole stack: wire schema → method contract → worker impl — the
// file's top-level export is a ServiceMethod unit built by serviceMethod().
// defineService unwraps its `def`; implementService unwraps its `run`.
import { z } from 'zod';
import { scoped, serviceMethod } from '@jwhenry123/mesh/sdk';
import { CITIES, REGIONS, SERVICES, incidentsMemory, type Incident } from '../contract/memory.contracts';

const log = scoped('incidents');
const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const rec = {} as Incident;
let seeded = false;

/** SeedIncidents — populate the shared incident table; returns elapsed ms. */
export const seedIncidents = serviceMethod({
  def: { resultSchema: z.number() },
  run(): number {
    if (seeded) {
      log.info('seed requested but store already populated — skipping');
      return 0;
    }
    const t0 = performance.now();
    const conn = incidentsMemory.lists.incidents;
    const progress = incidentsMemory.signals.seedProgress;
    const rand = mulberry32(1337);
    const N = conn.recordCount;
    const CHUNK = 100_000;
    log.info(`seeding ${fmtInt(N)} records (${conn.recordSize}B each)`);
    for (let i = 0; i < N; i++) {
      conn.writeAt(i, genIncident(i, rand, rec));
      if ((i + 1) % CHUNK === 0) {
        conn.commit();
        progress.write(((i + 1) / N) * 100);
        log.debug(`seed chunk committed: ${fmtInt(i + 1)}/${fmtInt(N)}`);
      }
    }
    conn.commit();
    progress.write(100);
    seeded = true;
    const ms = performance.now() - t0;
    log.info(`seed complete in ${ms.toFixed(0)}ms (${fmtInt(N / (ms / 1000))} records/sec)`);
    return ms;
  },
});

/* ── deterministic record generator (seed impl detail) ─────────────────── */

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function genIncident(id: number, rand: () => number, out: Incident): Incident {
  const sv = rand();
  out.id = id;
  out.openedAt = Math.floor(Date.now() / 1000) - ((rand() * 90 * 86400) | 0);
  out.durationMin = (rand() * rand() * 2880) | 0;
  out.customers = (rand() * rand() * 5000) | 0;
  out.alarms = 1 + ((rand() * 20) | 0);
  out.severity = sv < 0.5 ? 0 : sv < 0.8 ? 1 : sv < 0.95 ? 2 : 3;
  out.status = rand() < 0.35 ? 0 : rand() < 0.55 ? 1 : 2;
  out.region = (rand() * REGIONS.length) | 0;
  out.service = (rand() * SERVICES.length) | 0;
  out.site = `${CITIES[(rand() * CITIES.length) | 0]}-${1000 + ((rand() * 9000) | 0)}`;
  return out;
}
