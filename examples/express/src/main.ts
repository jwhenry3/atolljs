import './devtools'; // first — installs the sink before ./incidents spawns the pool
import express from 'express';
import { closePool, incidents, parseQueryArgs, readIncident, seedProgress } from './incidents';

/**
 * Express REST API over the incidents worker pool. Every /api/incidents/*
 * route either dispatches a pool task (seed/stats/query) or reads the shared
 * buffer directly on the API thread (seed-progress, :id).
 */
const app = express();

// Re-seed the 1M-record store — the write loop runs on a pool worker while
// the HTTP thread stays free.
app.post('/api/incidents/seed', async (_req, res) => {
  res.json({ seeded: true, ms: await incidents.seedIncidents() });
});

app.get('/api/incidents/seed-progress', (_req, res) => {
  res.json({ progress: seedProgress() });
});

app.get('/api/incidents/stats', async (_req, res) => {
  res.json(await incidents.computeMetrics());
});

// /api/incidents/query?severity=critical&status=open&limit=50&sortBy=customers&sortDesc=true
app.get('/api/incidents/query', async (req, res) => {
  res.json(await incidents.queryIncidents(parseQueryArgs(req.query)));
});

app.get('/api/incidents/:id', (req, res) => {
  const rec = readIncident(Number(req.params.id));
  if (!rec) {
    res.status(404).json({ error: `incident ${req.params.id} out of range` });
    return;
  }
  res.json(rec);
});

const port = Number(process.env.PORT ?? 3200);
const server = app.listen(port, () => {
  console.log(`atoll incidents api (express) → http://localhost:${port}/api/incidents/stats`);
  // Seed on bootstrap so the API never serves an empty store.
  void incidents.seedIncidents().catch(console.error);
});

const shutdown = () => {
  closePool();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
