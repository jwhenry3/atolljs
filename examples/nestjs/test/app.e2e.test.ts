/**
 * End-to-end functional test for the NestJS example: builds the app with the
 * real toolchain (tsc + nest/webpack worker bundles), boots it on an
 * ephemeral port, and exercises the HTTP surface — the same flow a user runs.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SOCKET_TRANSFER_SUPPORTED } from '@atolljs/node/http';

const exampleDir = dirname(fileURLToPath(new URL('.', import.meta.url)));
const PORT = 3910;
const TRANSFER_PORT = 3911;
const base = `http://localhost:${PORT}/api`;
const transferBase = `http://localhost:${TRANSFER_PORT}/api/housed`;

let child: ChildProcess | undefined;

beforeAll(async () => {
  execFileSync('npm', ['run', 'build'], { cwd: exampleDir, stdio: 'pipe', shell: true });
  child = spawn('node', [join(exampleDir, 'dist', 'main.js')], {
    env: { ...process.env, PORT: String(PORT), TRANSFER_PORT: String(TRANSFER_PORT) },
    stdio: 'pipe',
  });
  // Seed-on-bootstrap means the port only accepts once the buffer is populated.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`${base}/incidents/stats`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('nest example did not start');
    await new Promise((r) => setTimeout(r, 400));
  }
}, 180_000);

afterAll(() => {
  child?.kill();
});

describe('nestjs example e2e', () => {
  it('auto-seeded the incidents buffer (SeedOnBootstrap)', async () => {
    const stats = await (await fetch(`${base}/incidents/stats`)).json();
    expect(stats.total).toBe(1_000_000);
    expect(stats.open + stats.acknowledged + stats.resolved).toBe(1_000_000);
  });

  it('serves a populated record', async () => {
    const rec = await (await fetch(`${base}/incidents/42`)).json();
    expect(rec.id).toBe(42);
    expect(rec.site).toMatch(/^[A-Z]{3}-\d{4}$/);
  });

  it('runs @AtollTask service methods inside workers', async () => {
    const hs = await (await fetch(`${base}/incidents/hotspots?limit=3`)).json();
    expect(Array.isArray(hs)).toBe(true);
    expect(hs.length).toBeGreaterThan(0);
    expect(hs[0]).toHaveProperty('site');
  });

  it('houses a partial API entirely inside workers', async () => {
    // /api/housed/* proxies to a Nest app living in the pool workers —
    // the controller + DI run off the API thread and stamp the threadId.
    // Workers announce their internal ports async — retry until it lands.
    let who: { worker?: number } = {};
    const deadline = Date.now() + 30_000;
    for (;;) {
      const res = await fetch(`${base}/housed/incidents/whoami`);
      if (res.ok) {
        who = await res.json();
        break;
      }
      if (Date.now() > deadline) throw new Error('housed API never came up');
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(who.worker).toBeGreaterThan(0);

    const stats = await (await fetch(`${base}/housed/incidents/stats`)).json();
    expect(stats.worker).toBeGreaterThan(0);
    expect(stats.total).toBe(1_000_000);
    expect(stats.open + stats.acknowledged + stats.resolved).toBe(1_000_000);

    const query = await (
      await fetch(`${base}/housed/incidents/query?severity=critical&limit=5`)
    ).json();
    expect(query.worker).toBeGreaterThan(0);
    expect(query.total).toBe(1_000_000);
    for (const row of query.rows) expect(row.severity).toBe(3);

    // DI in the worker: hotspots runs IncidentsAnalytics with this worker's
    // own ScanTelemetry instance.
    const hs = await (await fetch(`${base}/housed/incidents/hotspots?limit=3`)).json();
    expect(hs.worker).toBeGreaterThan(0);
    expect(hs.hotspots.length).toBeGreaterThan(0);
    expect(hs.hotspots[0]).toHaveProperty('site');
  });

  it.runIf(SOCKET_TRANSFER_SUPPORTED)(
    'serves the housed API clustered (no main-thread parsing)',
    async () => {
      // The transfer port hands whole connections to housed workers — the
      // same /api/housed/* routes, reached without the proxy hop.
      const res = await fetch(`${transferBase}/incidents/whoami`);
      expect(res.ok).toBe(true);
      const who = await res.json();
      expect(who.worker).toBeGreaterThan(0);
    },
  );

  it('proxies housed routes to workers round-robin', async () => {
    const hits = await Promise.all(
      Array.from({ length: 6 }, () =>
        fetch(`${base}/housed/incidents/whoami`).then((r) => r.json()),
      ),
    );
    // 'auto' pool is >1 worker — round-robin selection lands on more than one.
    expect(new Set(hits.map((h) => h.worker)).size).toBeGreaterThan(1);
  });

  it('dispatches @AtollService facade calls into the reports pool', async () => {
    // The facade: ReportService methods are proxies on the API thread —
    // DashboardService (plain injectable, zero atoll imports) composes two
    // worker dispatches into one response.
    const overview = await (await fetch(`${base}/reports/overview`)).json();
    expect(overview.total).toBe(1_000_000);
    expect(overview.generatedBy.threadId).toBeGreaterThan(0);

    // Parameterized dispatch — args cross postMessage, the scan runs in-worker.
    const region = await (await fetch(`${base}/reports/region/west`)).json();
    expect(region.region).toBe('west');
    expect(region.total).toBeGreaterThan(0);
    expect(region.total).toBeLessThan(1_000_000);
    expect(typeof region.topService).toBe('string');

    // Per-worker injected state proves DI resolved inside the pool worker.
    const worker = await (await fetch(`${base}/reports/worker`)).json();
    expect(worker.threadId).toBeGreaterThan(0);
  });

  it('runs the second (digest) pool on its own workers', async () => {
    const res = await fetch(`${base}/digest/hash`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rounds: 10_000 }),
    });
    const json = await res.json();
    expect(json.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(json.jobsDone).toBeGreaterThanOrEqual(1);

    const worker = await (await fetch(`${base}/digest/worker`)).json();
    expect(worker.threadId).toBeGreaterThan(0);
  });
});
