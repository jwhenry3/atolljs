import { defineSharedMemory, field, reef, type InferField, type ListRecord } from '@atolljs/core';

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
 * List members are declared once as reef/zod schemas: each member is the
 * record's validator AND its binary layout spec — `reef.int(0, 3)` stores as
 * u8 while keeping the domain bound in validation:
 *
 *   incidentsMemory.spec.lists.incidents.schema → the declared record schema
 *   incidentsMemory.spec.lists.incidents.layout → compiled token spec
 *   incidentsMemory.schemas.lists.incidents     → the same record schema
 */
export const incidentsMemory = defineSharedMemory({
  lists: {
    incidents: field.list({
      schema: reef.object({
        id: reef.u32(),
        openedAt: reef.u32(),
        durationMin: reef.u32(),
        customers: reef.u32(),
        alarms: reef.u16(),
        severity: reef.int(0, 3), // domain bounds → u8 storage
        status: reef.int(0, 2),
        region: reef.int(0, 4),
        service: reef.int(0, 5),
        site: reef.string(10),
      }),
      count: 1_000_000,
    }),
  },
  state: {
    // No maxBytes — the schema's member widths derive the byte layout
    // (8 × f64 = 64B record + header). Stored inline, no codec involved.
    metrics: field.object({
      schema: reef.object({
        total: reef.f64(),
        open: reef.f64(),
        acknowledged: reef.f64(),
        resolved: reef.f64(),
        critical: reef.f64(),
        customersAffected: reef.f64(),
        avgDurationMin: reef.f64(),
        scanMs: reef.f64(),
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

/** The incident record's declared schema — a reef.object of fixed-width members. */
export const incidentSpec = incidentsMemory.spec.lists.incidents.schema;
/** One incident row as a reef schema — the same declared schema. */
export const incidentRowSchema = incidentsMemory.schemas.lists.incidents;
/** The metrics field's declared schema. */
export const metricsSchema = incidentsMemory.schemas.state.metrics;
export const INCIDENT_FIELDS = Object.keys(incidentSpec.shape) as (keyof Incident)[];

export type Incident = ListRecord<typeof incidentSpec>;
export type IncidentRow = Incident;
export type Metrics = InferField<typeof incidentsMemory.spec.state.metrics>;
