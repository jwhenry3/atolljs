import { z } from 'zod';
import { defineSharedMemory, field, structSchema } from '@jwhenry123/mesh/sdk';

export const SEVERITIES = ['info', 'minor', 'major', 'critical'] as const;
export const STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export const REGIONS = ['northeast', 'southeast', 'midwest', 'west', 'southwest'] as const;
export const SERVICES = ['ran', 'core', 'transport', 'oss', 'voip', 'broadband'] as const;
export const CITIES = [
  'NYC', 'CHI', 'DAL', 'ATL', 'LAX', 'SEA', 'DEN', 'MIA', 'BOS', 'PHX',
  'HOU', 'MSP', 'PHI', 'SFO', 'SLC', 'NAS', 'CLT', 'DET', 'PIT', 'STL',
] as const;

export const incidentSpec = {
  id: 'u32',
  openedAt: 'u32',
  durationMin: 'u32',
  customers: 'u32',
  alarms: 'u16',
  severity: 'u8',
  status: 'u8',
  region: 'u8',
  service: 'u8',
  site: { string: 10 },
} as const;

export const INCIDENT_FIELDS = Object.keys(incidentSpec) as (keyof Incident)[];
export const incidentRowSchema = structSchema(incidentSpec);

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

export const queryResultSchema = z.object({
  rows: z.array(incidentRowSchema),
  total: z.number(),
  filtered: z.number(),
  scanMs: z.number(),
  sortMs: z.number(),
});

export const metricsSchema = z.object({
  total: z.number(),
  open: z.number(),
  acknowledged: z.number(),
  resolved: z.number(),
  critical: z.number(),
  customersAffected: z.number(),
  avgDurationMin: z.number(),
  scanMs: z.number(),
});

export type Incident = z.infer<typeof incidentRowSchema>;
export type IncidentRow = Incident;
export type QueryArgs = z.infer<typeof queryArgsSchema>;
export type QueryResult = z.infer<typeof queryResultSchema>;
export type Metrics = z.infer<typeof metricsSchema>;

export const incidentsMemory = defineSharedMemory({
  incidents: field.struct({ fields: incidentSpec, count: 1_000_000 }),
  metrics: field.object({ maxBytes: 2048, schema: metricsSchema }),
  seedProgress: field.number(),
});
