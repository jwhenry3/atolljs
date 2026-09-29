import Fastify from 'fastify';
import { closePool, incidents, parseQueryArgs, readIncident, seedProgress } from './incidents';

/**
 * Fastify REST API over the incidents worker pool. Every /api/incidents/*
 * route either dispatches a pool task (seed/stats/query) or reads the shared
 * buffer directly on the API thread (seed-progress, :id).
 */
const app = Fastify();

// Re-seed the 1M-record store — the write loop runs on a pool worker while
// the HTTP thread stays free.
app.post('/api/incidents/seed', async () => ({
  seeded: true,
  ms: await incidents.seedIncidents(),
}));

app.get('/api/incidents/seed-progress', async () => ({ progress: seedProgress() }));

app.get('/api/incidents/stats', async () => incidents.computeMetrics());

// /api/incidents/query?severity=critical&status=open&limit=50&sortBy=customers&sortDesc=true
app.get('/api/incidents/query', async (req) =>
  incidents.queryIncidents(parseQueryArgs(req.query as Record<string, unknown>)),
);

app.get('/api/incidents/:id', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const rec = readIncident(Number(id));
  if (!rec) return reply.code(404).send({ error: `incident ${id} out of range` });
  return rec;
});

const port = Number(process.env.PORT ?? 3201);
await app.listen({ port });
console.log(`atoll incidents api (fastify) → http://localhost:${port}/api/incidents/stats`);

// Seed on bootstrap so the API never serves an empty store.
void incidents.seedIncidents().catch(console.error);

const shutdown = () => {
  closePool();
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
