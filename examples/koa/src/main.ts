import Koa from 'koa';
import Router from '@koa/router';
import { closePool, incidents, parseQueryArgs, readIncident, seedProgress } from './incidents';

/**
 * Koa REST API over the incidents worker pool. Every /api/incidents/* route
 * either dispatches a pool task (seed/stats/query) or reads the shared buffer
 * directly on the API thread (seed-progress, :id).
 */
const app = new Koa();
const router = new Router();

// Re-seed the 1M-record store — the write loop runs on a pool worker while
// the HTTP thread stays free.
router.post('/api/incidents/seed', async (ctx) => {
  ctx.body = { seeded: true, ms: await incidents.seedIncidents() };
});

router.get('/api/incidents/seed-progress', (ctx) => {
  ctx.body = { progress: seedProgress() };
});

router.get('/api/incidents/stats', async (ctx) => {
  ctx.body = await incidents.computeMetrics();
});

// /api/incidents/query?severity=critical&status=open&limit=50&sortBy=customers&sortDesc=true
router.get('/api/incidents/query', async (ctx) => {
  ctx.body = await incidents.queryIncidents(parseQueryArgs(ctx.query));
});

router.get('/api/incidents/:id', (ctx) => {
  const rec = readIncident(Number(ctx.params.id));
  if (!rec) {
    ctx.status = 404;
    ctx.body = { error: `incident ${ctx.params.id} out of range` };
    return;
  }
  ctx.body = rec;
});

app.use(router.routes()).use(router.allowedMethods());

const port = Number(process.env.PORT ?? 3203);
const server = app.listen(port, () => {
  console.log(`atoll incidents api (koa) → http://localhost:${port}/api/incidents/stats`);
  // Seed on bootstrap so the API never serves an empty store.
  void incidents.seedIncidents().catch(console.error);
});

const shutdown = () => {
  closePool();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
