// Express app factory — runs INSIDE each worker thread, so every route,
// every middleware, and every byte of response serialization executes off
// the API thread. `worker` (the worker_threads threadId) is stamped on each
// response so connection routing is observable from the client.
import express from 'express';
import { threadId } from 'node:worker_threads';
import {
  INCIDENT_FIELDS,
  SEVERITIES,
  STATUSES,
  incidentsMemory,
  type Incident,
} from '@atolljs/incidents';
import { computeMetrics } from '@atolljs/incidents/service/computeMetrics';
import { queryIncidents } from '@atolljs/incidents/service/queryIncidents';
import { seedIncidents } from '@atolljs/incidents/service/seedIncidents';

const indexOf = (list: readonly string[], v: unknown): number | null =>
  typeof v === 'string' && list.includes(v) ? list.indexOf(v) : null;

export function createApp() {
  const app = express();
  const rec = {} as Incident;

  app.use(express.json());
  app.use((_req, res, next) => {
    res.setHeader('x-worker', String(threadId));
    next();
  });

  // Minimal endpoint to observe which worker served the connection.
  app.get('/api/whoami', (_req, res) => {
    res.json({ worker: threadId });
  });

  app.post('/api/incidents/seed', (_req, res) => {
    if (incidentsMemory.signals.seedProgress.read() >= 100) {
      res.json({ seeded: false, ms: 0, worker: threadId });
      return;
    }
    res.json({ seeded: true, ms: seedIncidents.run(), worker: threadId });
  });

  app.get('/api/incidents/seed-progress', (_req, res) => {
    res.json({ progress: incidentsMemory.signals.seedProgress.read(), worker: threadId });
  });

  app.get('/api/incidents/stats', (_req, res) => {
    res.json({ ...computeMetrics.run(), worker: threadId });
  });

  app.get('/api/incidents/query', (req, res) => {
    const result = queryIncidents.run({
      offset: Number(req.query.offset ?? 0),
      limit: Math.min(Number(req.query.limit ?? 50), 200),
      sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : null,
      sortDesc: req.query.sortDesc === 'true',
      severity: indexOf(SEVERITIES, req.query.severity),
      status: indexOf(STATUSES, req.query.status),
      region: null,
      service: null,
      search: String(req.query.search ?? ''),
    });
    res.json({ ...result, worker: threadId });
  });

  app.get('/api/incidents/:id', (req, res) => {
    const id = Number(req.params.id);
    const conn = incidentsMemory.lists.incidents;
    if (!Number.isInteger(id) || id < 0 || id >= conn.recordCount) {
      res.status(404).json({ error: `incident ${req.params.id} not found`, worker: threadId });
      return;
    }
    res.json({ ...conn.readAt(id, rec, INCIDENT_FIELDS), worker: threadId });
  });

  return app;
}
