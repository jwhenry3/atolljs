import { Worker } from 'node:worker_threads';
import { workerClient } from '@atolljs/core';
import { createNodePool } from '@atolljs/node';
import {
  incidentsMemory,
  REGIONS,
  SERVICES,
  SEVERITIES,
  STATUSES,
  type Incident,
  type IncidentsWorker,
  type QueryArgs,
} from '@atolljs/incidents';

/**
 * The atoll on the server: a WorkerPool of node:worker_threads workers bound
 * to the 1M-record incidents contract. The factory returns a Node Worker —
 * createNodePool adapts it to the DOM surface the pool expects.
 *
 * The worker entry is bundled to dist/incidents.worker.js by esbuild (npm
 * run bundle — dev/build/start run it first). Bundling is required because
 * Node's worker_threads spawns a fresh process outside tsx's loader, so the
 * entry's bare @atolljs/* specifiers must already be resolved. The app code
 * itself runs unbundled under tsx.
 */
export const pool = createNodePool({
  worker: () => new Worker(new URL('../dist/incidents.worker.js', import.meta.url)),
  sharedMemory: incidentsMemory,
  poolSize: 'auto',
});

/** Typed client — calls read like the worker's own method names. */
export const incidents = workerClient<IncidentsWorker>(pool);

const str = (v: unknown) =>
  v == null ? undefined : Array.isArray(v) ? String(v[0]) : String(v);

const toIndex = (list: readonly string[], value?: string) =>
  value == null || value === '' ? null : Math.max(0, list.indexOf(value));

/** Query-string params → QueryArgs, the same shape the frontend sends. */
export const parseQueryArgs = (q: Record<string, unknown>): QueryArgs => ({
  offset: Math.max(0, parseInt(str(q.offset) ?? '0', 10) || 0),
  limit: Math.min(200, Math.max(1, parseInt(str(q.limit) ?? '50', 10) || 50)),
  sortBy: str(q.sortBy) ?? null,
  sortDesc: str(q.sortDesc) === 'true',
  severity: toIndex(SEVERITIES, str(q.severity)),
  status: toIndex(STATUSES, str(q.status)),
  region: toIndex(REGIONS, str(q.region)),
  service: toIndex(SERVICES, str(q.service)),
  search: str(q.search) ?? '',
});

/** Direct shared-memory record read on the API thread — zero dispatch. */
export const readIncident = (id: number): Incident | null => {
  const conn = incidentsMemory.lists.incidents;
  if (!Number.isInteger(id) || id < 0 || id >= conn.recordCount) return null;
  return conn.readAt(id, {} as Incident);
};

/** The shared seed counter — a free main-thread read. */
export const seedProgress = () => incidentsMemory.signals.seedProgress.read();

/** Drop the pool on shutdown; workers don't outlive the process anyway. */
export const closePool = () => pool.terminate();
