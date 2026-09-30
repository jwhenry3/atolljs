// One task's whole stack: wire schemas → method contract → worker impl.
import { z } from 'zod';
import { reef, scoped, serviceMethod } from '@atolljs/core';
import { INCIDENT_FIELDS, incidentRowSchema, incidentsMemory, type Incident } from '../contract/memory.contracts';

const log = scoped('incidents');
const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const rec = {} as Incident;

/* ── wire schemas ── */

export const queryArgsSchema = z.object({
  offset: z.number(),
  limit: z.number(),
  sortBy: z.string().nullable(),
  sortDesc: z.boolean(),
  severity: z.number().nullable(),
  status: z.number().nullable(),
  region: z.number().nullable(),
  service: z.number().nullable(),
  search: z.string(),
});

// reef members nest — a real z.array can't parse an atoll-minted element
// (it dispatches through zod internals), so the result schema is reef too.
export const queryResultSchema = reef.object({
  rows: reef.array(incidentRowSchema),
  total: reef.f64(),
  filtered: reef.f64(),
  scanMs: reef.f64(),
  sortMs: reef.f64(),
});

export type QueryArgs = z.infer<typeof queryArgsSchema>;
export type QueryResult = z.infer<typeof queryResultSchema>;

/** QueryIncidents — filter/sort/page scan over the shared incident table. */
export const queryIncidents = serviceMethod({
  def: {
    argsSchema: z.tuple([queryArgsSchema]),
    resultSchema: queryResultSchema,
  },
  run(q) {
    const t0 = performance.now();
    const conn = incidentsMemory.lists.incidents;
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
  },
});
