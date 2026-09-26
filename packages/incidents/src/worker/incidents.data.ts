import { CITIES, REGIONS, SERVICES, type Incident } from '../contract/memory.contracts';

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
