/**
 * End-to-end functional test for the NestJS example: builds the app with the
 * real toolchain (tsc + nest/webpack worker bundles), boots it on an
 * ephemeral port, and exercises the HTTP surface — the same flow a user runs.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const exampleDir = dirname(fileURLToPath(new URL('.', import.meta.url)));
const PORT = 3910;
const base = `http://localhost:${PORT}/api`;

let child: ChildProcess | undefined;

beforeAll(async () => {
  execFileSync('npm', ['run', 'build'], { cwd: exampleDir, stdio: 'pipe', shell: true });
  child = spawn('node', [join(exampleDir, 'dist', 'main.js')], {
    env: { ...process.env, PORT: String(PORT) },
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
