import { defineSharedMemory, field, mz, type InferField, type ListRecord } from '@jwhenry123/mesh/sdk';

export const SEVERITIES = ['info', 'minor', 'major', 'critical'] as const;
export const STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export const REGIONS = ['northeast', 'southeast', 'midwest', 'west', 'southwest'] as const;
export const SERVICES = ['ran', 'core', 'transport', 'oss', 'voip', 'broadband'] as const;
export const CITIES = [
  'NYC', 'CHI', 'DAL', 'ATL', 'LAX', 'SEA', 'DEN', 'MIA', 'BOS', 'PHX',
  'HOU', 'MSP', 'PHI', 'SFO', 'SLC', 'NAS', 'CLT', 'DET', 'PIT', 'STL',
] as const;

/**
 * The shared memory contract — the single source of truth, grouped by intent:
 *
 *   lists    — fixed-layout record arrays scanned in workers (no serialize)
 *   state    — structured snapshots rewritten wholesale (codec-encoded)
 *   signals  — scalar fields observed reactively (versioned)
 *
 * List members are declared once as mz/zod schemas: each member is the
 * record's validator AND its binary layout spec — `mz.int(0, 3)` stores as
 * u8 while keeping the domain bound in validation:
 *
 *   incidentsMemory.spec.lists.incidents.schema → the declared record schema
 *   incidentsMemory.spec.lists.incidents.layout → compiled token spec
 *   incidentsMemory.schemas.lists.incidents     → the same record schema
 */
export const incidentsMemory = defineSharedMemory({
  lists: {
    incidents: field.list({
      schema: mz.object({
        id: mz.u32(),
        openedAt: mz.u32(),
        durationMin: mz.u32(),
        customers: mz.u32(),
        alarms: mz.u16(),
        severity: mz.int(0, 3), // domain bounds → u8 storage
        status: mz.int(0, 2),
        region: mz.int(0, 4),
        service: mz.int(0, 5),
        site: mz.string(10),
      }),
      count: 1_000_000,
    }),
  },
  state: {
    // No maxBytes — the schema's member widths derive the byte layout
    // (8 × f64 = 64B record + header). Stored inline, no codec involved.
    metrics: field.object({
      schema: mz.object({
        total: mz.f64(),
        open: mz.f64(),
        acknowledged: mz.f64(),
        resolved: mz.f64(),
        critical: mz.f64(),
        customersAffected: mz.f64(),
        avgDurationMin: mz.f64(),
        scanMs: mz.f64(),
      }),
    }),
  },
  signals: {
    seedProgress: field.number(),
  },
});

/* ── re-exports derived from the contract ──────────────────────────────────
   Same names as before — consumers keep working, but nothing is declared
   twice. */

/** The incident record's declared schema — an mz.object of fixed-width members. */
export const incidentSpec = incidentsMemory.spec.lists.incidents.schema;
/** One incident row as a zod schema — the same declared schema. */
export const incidentRowSchema = incidentsMemory.schemas.lists.incidents;
/** The metrics field's declared schema. */
export const metricsSchema = incidentsMemory.schemas.state.metrics;
export const INCIDENT_FIELDS = Object.keys(incidentSpec.shape) as (keyof Incident)[];

export type Incident = ListRecord<typeof incidentSpec>;
export type IncidentRow = Incident;
export type Metrics = InferField<typeof incidentsMemory.spec.state.metrics>;
