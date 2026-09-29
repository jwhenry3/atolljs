// @vitest-environment happy-dom
/**
 * Worker-vs-main cost split for a worker-hosted sub-application.
 *
 * In-process workers run tasks synchronously on one thread, so the two
 * sides are separately measurable: the awaited `client.*` call duration is
 * the WORKER side (render/diff/proxy-bookkeeping/op serialization — plus a
 * ~0 in-process transport cost instead of structuredClone+postMessage), and
 * the `onOps` hook's elapsed is the MAIN side (op replay = real DOM calls).
 * Real workers add per-batch marshalling; the ratio is what matters here.
 *
 * Numbers are logged, not asserted — assertions only cover correctness so
 * the harness can't flake on a slow machine.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { IslandClient } from '../src/index';
import type { Op } from '../src/ops';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/perf.worker')];

let mountIsland: typeof import('../src/index').mountIsland;
let connectIslandWorker: typeof import('../src/index').connectIslandWorker;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ connectIslandWorker, mountIsland } = await import('../src/index'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/perf.worker.ts', import.meta.url), { type: 'module' });

interface CallTiming {
  method: string;
  ms: number;
}
interface BatchTiming {
  ops: readonly Op[];
  ms: number;
}

/** Wrap a client so every task call's awaited duration is recorded. */
const instrument = (
  client: IslandClient,
): { client: IslandClient; calls: CallTiming[] } => {
  const calls: CallTiming[] = [];
  const TASK_METHODS = new Set(['mount', 'updateProps', 'dispatch', 'flush', 'setSize', 'unmount']);
  const wrapped = new Proxy(client as object, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v === 'function' && TASK_METHODS.has(String(prop))) {
        // The client is a call-path Proxy — `v.apply` would read 'apply' as a
        // task segment. Invoke the trap'd function directly.
        return async (...args: unknown[]) => {
          const t0 = performance.now();
          const out = await (v as (...a: unknown[]) => Promise<unknown>)(...args);
          calls.push({ method: String(prop), ms: performance.now() - t0 });
          return out;
        };
      }
      return v;
    },
  });
  return { client: wrapped as IslandClient, calls };
};

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

const report = (
  scenario: string,
  calls: CallTiming[],
  batches: BatchTiming[],
): { workerMs: number; mainMs: number; ops: number } => {
  const workerMs = sum(calls.map((c) => c.ms));
  const mainMs = sum(batches.map((b) => b.ms));
  const ops = sum(batches.map((b) => b.ops.length));
  const total = workerMs + mainMs || 1;
  console.log(
    `[perf] ${scenario}: worker=${workerMs.toFixed(1)}ms main=${mainMs.toFixed(1)}ms ` +
      `ops=${ops} → main share ${((100 * mainMs) / total).toFixed(0)}%`,
  );
  return { workerMs, mainMs, ops };
};

describe('island perf split', () => {
  it('measures mount / rebuild / patch / dispatch for imperative and React mounts', async () => {
    const results: Record<string, { workerMs: number; mainMs: number; ops: number }> = {};

    /* ── Imperative app: mount 200 rows, then updateProps = full rebuild ── */
    {
      const host = realDoc.createElement('div');
      realDoc.body.appendChild(host);
      const { client, calls } = instrument(connectIslandWorker({ worker: renderWorker }));
      const batches: BatchTiming[] = [];
      const island = await mountIsland({
        client,
        el: host,
        app: 'tree',
        props: { rows: 200, label: 'row' },
        onOps: (ops, ms) => batches.push({ ops, ms }),
      });
      expect(host.querySelectorAll('.row').length).toBe(200);
      results['imperative mount (200 rows)'] = report(
        'imperative mount (200 rows)',
        calls.filter((c) => c.method === 'mount'),
        batches.splice(0),
      );

      calls.length = 0;
      await island.updateProps({ rows: 200, label: 'renamed' });
      expect(host.querySelector('.cell')?.textContent).toBe('renamed 0');
      results['imperative updateProps (rebuild)'] = report(
        'imperative updateProps (rebuild)',
        calls.splice(0),
        batches.splice(0),
      );

      // Click a .bump → dispatch → single utext + emit back.
      calls.length = 0;
      host.querySelector<HTMLElement>('.bump')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      await vi.waitFor(() =>
        expect(host.querySelector('.cell')?.textContent).toBe('renamed 0!'),
      );
      results['imperative click dispatch'] = report(
        'imperative click dispatch',
        calls.splice(0),
        batches.splice(0),
      );

      island.destroy();
    }

    /* ── React app: same tree — mount, then diffed updateProps ── */
    {
      const host = realDoc.createElement('div');
      realDoc.body.appendChild(host);
      const { client, calls } = instrument(connectIslandWorker({ worker: renderWorker }));
      const batches: BatchTiming[] = [];
      const island = await mountIsland({
        client,
        el: host,
        app: 'rtree',
        props: { rows: 200, label: 'row' },
        onOps: (ops, ms) => batches.push({ ops, ms }),
      });
      expect(host.querySelectorAll('.row').length).toBe(200);
      results['react mount (200 rows)'] = report(
        'react mount (200 rows)',
        calls.filter((c) => c.method === 'mount'),
        batches.splice(0),
      );

      calls.length = 0;
      const cell0 = host.querySelector('.cell')!;
      await island.updateProps({ rows: 200, label: 'renamed' });
      // Diffed patch: same nodes survive, only text changed.
      expect(host.querySelector('.cell')).toBe(cell0);
      expect(cell0.textContent).toBe('renamed 0');
      results['react updateProps (diffed patch)'] = report(
        'react updateProps (diffed patch)',
        calls.splice(0),
        batches.splice(0),
      );
      // Sanity: the diffed patch should be far fewer ops than the
      // imperative rebuild's clear+recreate (200 changed cells → ~800 ops
      // vs ~2600).
      expect(results['react updateProps (diffed patch)'].ops).toBeLessThan(
        results['imperative updateProps (rebuild)'].ops / 2,
      );

      island.destroy();
    }

    /* ── React stateful leaf: one click → one commit ── */
    {
      const host = realDoc.createElement('div');
      realDoc.body.appendChild(host);
      const { client, calls } = instrument(connectIslandWorker({ worker: renderWorker }));
      const batches: BatchTiming[] = [];
      const island = await mountIsland({
        client,
        el: host,
        app: 'rcounter',
        props: { label: 'count' },
        onOps: (ops, ms) => batches.push({ ops, ms }),
      });
      await vi.waitFor(() =>
        expect(host.querySelector('.btn')?.textContent).toBe('count: 0'),
      );

      calls.length = 0;
      batches.length = 0;
      host.querySelector<HTMLElement>('.btn')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      await vi.waitFor(() =>
        expect(host.querySelector('.btn')?.textContent).toBe('count: 1'),
      );
      results['react click → setState commit'] = report(
        'react click → setState commit',
        calls.splice(0),
        batches.splice(0),
      );

      island.destroy();
    }

    // The headline number: across every measured interaction, the worker
    // should carry the bulk of JS time (framework diffing + shadow-tree
    // bookkeeping + op serialization); the main thread only replays ops.
    const totWorker = sum(Object.values(results).map((r) => r.workerMs));
    const totMain = sum(Object.values(results).map((r) => r.mainMs));
    const split = (100 * totWorker) / (totWorker + totMain);
    console.log(`[perf] overall JS split — worker ${split.toFixed(0)}% / main ${(100 - split).toFixed(0)}%`);
    expect(totWorker).toBeGreaterThan(0);
    expect(totMain).toBeGreaterThan(0);
  });
});
