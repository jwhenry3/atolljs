/**
 * Next.js server bootstrap hook — runs once when the Node.js runtime boots,
 * before the server accepts requests. Warming the pools here means workers
 * spawn and the 1M-record incidents buffer seeds during startup instead of
 * inside the first unlucky request.
 *
 * Dynamic imports keep node:worker_threads out of the edge/browser bundle
 * graphs — this file is compiled for every runtime but only executed in one.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getDigest } = await import('./app/api/atoll/pool');
  const { getJobs } = await import('./app/api/jobs/pool');
  const { getIncidentsApi } = await import('./app/api/incidents/pool');
  getDigest();
  getJobs();
  // Seed, then have a worker aggregate metrics — the read-model endpoints
  // report live seedProgress while this runs.
  void getIncidentsApi()
    .client.seedIncidents()
    .then(() => getIncidentsApi().client.computeMetrics())
    .catch((err) => console.error('[atoll] incident seed failed:', err));
}
