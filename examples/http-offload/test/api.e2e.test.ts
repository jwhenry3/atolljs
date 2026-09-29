/**
 * End-to-end test for the http-offload example's two topologies:
 *
 *   :3924 gateway (any Node) — path ownership: /api/a/* → worker A,
 *          /api/b/* → worker B, the rest on the main thread.
 *   :3925 clustered (Node ≥ 26) — connections routed unseen.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const exampleDir = dirname(fileURLToPath(new URL('.', import.meta.url)));
const PORT = 3924;
const base = `http://localhost:${PORT}/api`;
const SUPPORTED = Number(process.versions.node.split('.')[0]) >= 26;

let child: ChildProcess | undefined;

const get = (path: string) => fetch(`${base}${path}`);
const post = (path: string) => fetch(`${base}${path}`, { method: 'POST' });

beforeAll(async () => {
  execFileSync('npm', ['run', 'bundle'], { cwd: exampleDir, stdio: 'pipe', shell: true });
  child = spawn('node', ['--import', 'tsx', 'src/main.ts'], {
    cwd: exampleDir,
    env: { ...process.env, PORT: String(PORT), TRANSFER_PORT: '3925' },
    stdio: 'pipe',
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      // Ready when main answers AND both workers have announced their
      // internal ports (proxied routes 503 until their announce lands).
      const [m, a, b] = await Promise.all([get('/whoami'), get('/a/whoami'), get('/b/whoami')]);
      if (m.ok && a.ok && b.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('http-offload example did not start');
    await new Promise((r) => setTimeout(r, 300));
  }
}, 90_000);

afterAll(() => {
  child?.kill();
  child = undefined;
});

describe('http-offload gateway (mixed route ownership)', () => {
  it('serves the same route shape on three different threads', async () => {
    const [main, a, b] = await Promise.all([
      get('/whoami').then((r) => r.json()),
      get('/a/whoami').then((r) => r.json()),
      get('/b/whoami').then((r) => r.json()),
    ]);
    expect(main.worker).toBe(0); // main thread
    expect(a.worker).toBeGreaterThan(0);
    expect(b.worker).toBeGreaterThan(0);
    expect(a.worker).not.toBe(b.worker); // distinct pool slots
  });

  it('pins a prefix to one worker consistently', async () => {
    const hits = await Promise.all(
      Array.from({ length: 5 }, () => get('/a/whoami').then((r) => r.json())),
    );
    expect(new Set(hits.map((h) => h.worker)).size).toBe(1);
  });

  it('seeds via task dispatch and reports progress on the main thread', async () => {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const { progress, worker } = await (await get('/incidents/seed-progress')).json();
      expect(worker).toBe(0); // progress read served by main
      if (progress >= 100) return;
      if (Date.now() > deadline) throw new Error('seed did not complete');
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  it('serves worker-owned incident routes inside their workers', async () => {
    const whoA = await (await get('/a/whoami')).json();
    const whoB = await (await get('/b/whoami')).json();

    // worker A owns queries, worker B owns stats
    const query = await (await get('/a/incidents/query?severity=critical&limit=10')).json();
    expect(query.worker).toBe(whoA.worker);
    expect(query.total).toBe(1_000_000);
    for (const row of query.rows) expect(row.severity).toBe(3);

    const stats = await (await get('/b/incidents/stats')).json();
    expect(stats.worker).toBe(whoB.worker);
    expect(stats.total).toBe(1_000_000);
    expect(stats.open + stats.acknowledged + stats.resolved).toBe(1_000_000);
  });

  it('reads a single record on the main thread', async () => {
    const rec = await (await get('/incidents/42')).json();
    expect(rec.id).toBe(42);
    expect(rec.worker).toBe(0);
  });

  it('worker-side seed + main-thread record read share one store', async () => {
    const seed = await (await post('/a/incidents/seed')).json();
    expect(seed.seeded).toBe(false); // already seeded at boot
    const rec = await (await get('/incidents/7')).json();
    expect(rec.id).toBe(7);
    expect(rec.worker).toBe(0);
  });
});

describe.runIf(SUPPORTED)('http-offload clustering (Node ≥ 26)', () => {
  it('routes raw connections to workers on :3925', async () => {
    const transferBase = 'http://localhost:3925/api';
    const res = await fetch(`${transferBase}/whoami`, { headers: { connection: 'close' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worker).toBeGreaterThan(0);
    // Pooled sockets spread across both workers.
    const hits = await Promise.all(
      Array.from({ length: 6 }, () =>
        fetch(`${transferBase}/whoami`, { headers: { connection: 'close' } }).then((r) =>
          r.json(),
        ),
      ),
    );
    expect(new Set(hits.map((h) => h.worker)).size).toBeGreaterThan(1);
  });
});
