import { scoped, TaskRegistry } from '@jwhenry123/mesh/sdk';
import '@jwhenry123/mesh/sdk/worker/workerBootstrap';
import { ComputeMetrics, QueryIncidents, SeedIncidents } from '../contract/task.contracts';
import { INCIDENT_FIELDS, incidentsMemory, type Incident } from '../contract/memory.contracts';
import { genIncident, mulberry32 } from './incidents.data';

const log = scoped('incidents');
const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const rec = {} as Incident;
let seeded = false;

TaskRegistry.register(SeedIncidents, () => {
  if (seeded) {
    log.info('seed requested but store already populated — skipping');
    return 0;
  }
  const t0 = performance.now();
  const conn = incidentsMemory.incidents;
  const progress = incidentsMemory.seedProgress;
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
});

TaskRegistry.register(QueryIncidents, (q) => {
  const t0 = performance.now();
  const conn = incidentsMemory.incidents;
  const sortKey = q.sortBy as keyof Incident | null;
  const search = q.search.toUpperCase();
  const scan: (keyof Incident)[] =
    search || sortKey === 'site' ? INCIDENT_FIELDS : INCIDENT_FIELDS.filter((f) => f !== 'site');
  const matches: { i: number; k: number | string }[] = [];

  for (let i = 0; i < conn.recordCount; i++) {
    conn.readAt(i, rec, scan);
    if (q.severity !== null && rec.severity !== q.severity) continue;
    if (q.status !== null && rec.status !== q.status) continue;
    if (q.region !== null && rec.region !== q.region) continue;
    if (q.service !== null && rec.service !== q.service) continue;
    if (search && !rec.site.includes(search)) continue;
    matches.push({ i, k: sortKey ? (rec[sortKey] as number | string) : 0 });
  }
  const filtered = matches.length;
  const tScan = performance.now();

  if (sortKey) {
    const compare = (a: number | string, b: number | string) =>
      typeof a === 'string' ? a.localeCompare(b as string) : a - (b as number);
    matches.sort((a, b) => (q.sortDesc ? compare(b.k, a.k) : compare(a.k, b.k)));
  }
  const tSort = performance.now();
  const rows = matches
    .slice(q.offset, q.offset + q.limit)
    .map(({ i }) => ({ ...conn.readAt(i, rec, INCIDENT_FIELDS) }));

  log.debug(`query → ${fmtInt(filtered)} matches, page of ${fmtInt(rows.length)} (scan ${(tScan - t0).toFixed(1)}ms, sort ${(tSort - tScan).toFixed(1)}ms)`, {
    filters: { severity: q.severity, status: q.status, region: q.region, service: q.service, search: q.search || undefined },
    sort: q.sortBy ? `${q.sortBy}${q.sortDesc ? ' desc' : ''}` : null,
  });
  return { rows, total: conn.recordCount, filtered, scanMs: tScan - t0, sortMs: tSort - tScan };
});

TaskRegistry.register(ComputeMetrics, () => {
  const t0 = performance.now();
  const conn = incidentsMemory.incidents;
  const fields: (keyof Incident)[] = ['status', 'severity', 'customers', 'durationMin'];
  let open = 0;
  let acknowledged = 0;
  let resolved = 0;
  let critical = 0;
  let customersAffected = 0;
  let durationSum = 0;
  for (let i = 0; i < conn.recordCount; i++) {
    conn.readAt(i, rec, fields);
    if (rec.status === 0) open++;
    else if (rec.status === 1) acknowledged++;
    else resolved++;
    if (rec.severity === 3) critical++;
    customersAffected += rec.customers;
    durationSum += rec.durationMin;
  }
  const metrics = {
    total: conn.recordCount,
    open,
    acknowledged,
    resolved,
    critical,
    customersAffected,
    avgDurationMin: durationSum / conn.recordCount,
    scanMs: performance.now() - t0,
  };
  incidentsMemory.metrics.write(metrics);
  log.info(`metrics published: ${fmtInt(open + acknowledged + resolved)} incidents in ${metrics.scanMs.toFixed(1)}ms (${fmtInt(critical)} critical)`);
  return metrics;
});
