/**
 * End-to-end test for the Fastify example: bundles the worker entry (esbuild),
 * boots the API on an ephemeral port, and exercises the HTTP surface — the
 * same flow a user runs.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const exampleDir = dirname(fileURLToPath(new URL('.', import.meta.url)));
const PORT = 3921;
const base = `http://localhost:${PORT}/api/incidents`;

let child: ChildProcess | undefined;

beforeAll(async () => {
  // The worker entry must be bundled — node:worker_threads spawns plain Node
  // processes (no tsx hooks), so its @atolljs/* specifiers need resolving.
  execFileSync('npm', ['run', 'bundle'], { cwd: exampleDir, stdio: 'pipe', shell: true });
  // node --import tsx runs the app directly (tsx resolves the @atolljs/*
  // tsconfig paths on the API thread); spawned as one process so kill()
  // takes the workers down with it.
  child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: exampleDir,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  });
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const r = await fetch(`${base}/seed-progress`);
      if (r.ok && (await r.json()).progress === 100) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('fastify example did not start');
    await new Promise((r) => setTimeout(r, 400));
  }
}, 120_000);

afterAll(() => {
  child?.kill();
});

describe('fastify example e2e', () => {
  it('auto-seeded the incidents buffer', async () => {
    const stats = await (await fetch(`${base}/stats`)).json();
    expect(stats.total).toBe(1_000_000);
    expect(stats.open + stats.acknowledged + stats.resolved).toBe(1_000_000);
  });

  it('serves a populated record directly from shared memory', async () => {
    const rec = await (await fetch(`${base}/42`)).json();
    expect(rec.id).toBe(42);
    expect(rec.site).toMatch(/^[A-Z]{3}-\d{4}$/);
  });

  it('runs filtered queries on a pool worker', async () => {
    const res = await (await fetch(`${base}/query?severity=critical&status=open&limit=5`)).json();
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.length).toBeLessThanOrEqual(5);
    expect(res.rows.every((r: any) => r.severity === 3 && r.status === 0)).toBe(true);
    expect(res.scanMs).toBeGreaterThan(0);
  });

  it('re-seeds via POST /seed (already populated → no-op)', async () => {
    const res = await (await fetch(`${base}/seed`, { method: 'POST' })).json();
    expect(res.seeded).toBe(true);
  });

  it('404s out-of-range record ids', async () => {
    const res = await fetch(`${base}/99999999`);
    expect(res.status).toBe(404);
  });
});
