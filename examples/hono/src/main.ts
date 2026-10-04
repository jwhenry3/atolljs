import './devtools'; // first — installs the sink before ./incidents spawns the pool
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { closePool, incidents, parseQueryArgs, readIncident, seedProgress } from './incidents';

/**
 * Hono REST API over the incidents worker pool (served by
 * @hono/node-server). Every /api/incidents/* route either dispatches a pool
 * task (seed/stats/query) or reads the shared buffer directly on the API
 * thread (seed-progress, :id).
 */
const app = new Hono();

// Re-seed the 1M-record store — the write loop runs on a pool worker while
// the HTTP thread stays free.
app.post('/api/incidents/seed', async (c) =>
  c.json({ seeded: true, ms: await incidents.seedIncidents() }),
);

app.get('/api/incidents/seed-progress', (c) => c.json({ progress: seedProgress() }));

app.get('/api/incidents/stats', async (c) => c.json(await incidents.computeMetrics()));

// /api/incidents/query?severity=critical&status=open&limit=50&sortBy=customers&sortDesc=true
app.get('/api/incidents/query', async (c) =>
  c.json(await incidents.queryIncidents(parseQueryArgs(c.req.query()))),
);

app.get('/api/incidents/:id', (c) => {
  const id = c.req.param('id');
  const rec = readIncident(Number(id));
  if (!rec) return c.json({ error: `incident ${id} out of range` }, 404);
  return c.json(rec);
});

const port = Number(process.env.PORT ?? 3202);
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`atoll incidents api (hono) → http://localhost:${port}/api/incidents/stats`);
  // Seed on bootstrap so the API never serves an empty store.
  void incidents.seedIncidents().catch(console.error);
});

const shutdown = () => {
  closePool();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
