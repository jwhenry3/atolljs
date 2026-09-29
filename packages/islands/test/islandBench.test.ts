// @vitest-environment happy-dom
/**
 * Cross-framework processing-load benchmark — mounts the same 200-row tree
 * through every island adapter (bench.worker.ts fixture) and measures the
 * JS time on each side:
 *
 *   worker = the awaited client task call (render/diff/proxy bookkeeping/op
 *            serialization — transport ≈ 0 under InProcessWorker)
 *   main   = the onOps callback's elapsed (op replay = real DOM calls)
 *
 * Three scenarios per framework: mount, prop-driven update (label rename),
 * and one click dispatch → local-state commit.
 *
 * Numbers are logged on every run, plus one `[bench-stats] {json}` line
 * carrying the full result set — scripts/island-perf.mjs parses that line
 * into docs-consumer/src/islandPerfStats.ts. Assertions stay correctness-
 * only so the harness can't flake on a slow machine.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { IslandClient } from '../src/index';
import type { Op } from '../src/ops';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/bench.worker')];

let mountIsland: typeof import('../src/index').mountIsland;
let connectIslandWorker: typeof import('../src/index').connectIslandWorker;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ connectIslandWorker, mountIsland } = await import('../src/index'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/bench.worker.ts', import.meta.url), { type: 'module' });

/**
 * Warm-up islands stay mounted for the whole run: a framework adapter whose
 * dispose is async (svelte's `void unmount()`) keeps tearing down after the
 * unmount task returns, and in the shared in-process module graph that
 * teardown can surface inside a later task. Destroying them at the end —
 * after every measurement — keeps the leak out of the numbers.
 */
const warmIslands: { destroy(): void }[] = [];
afterAll(() => {
  for (const island of warmIslands) {
    try {
      island.destroy();
    } catch {
      /* teardown leak — measurements already taken */
    }
  }
});

interface CallTiming {
  method: string;
  ms: number;
}
interface BatchTiming {
  ops: readonly Op[];
  ms: number;
}
interface Scenario {
  workerMs: number;
  mainMs: number;
  ops: number;
}

const FRAMEWORKS = [
  { id: 'imp', label: 'Imperative (no framework)' },
  { id: 'react', label: 'React' },
  { id: 'vue', label: 'Vue' },
  { id: 'svelte', label: 'Svelte' },
  { id: 'solid', label: 'SolidJS' },
  { id: 'ng', label: 'Angular' },
] as const;
const SCENARIO_NAMES = ['mount', 'update', 'click'] as const;

const instrument = (
  client: IslandClient,
): { client: IslandClient; calls: CallTiming[] } => {
  const calls: CallTiming[] = [];
  const TASK_METHODS = new Set(['mount', 'updateProps', 'dispatch', 'flush', 'setSize', 'unmount']);
  const wrapped = new Proxy(client as object, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v === 'function' && TASK_METHODS.has(String(prop))) {
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

const measure = (calls: CallTiming[], batches: BatchTiming[]): Scenario => ({
  workerMs: sum(calls.map((c) => c.ms)),
  mainMs: sum(batches.map((b) => b.ms)),
  ops: sum(batches.map((b) => b.ops.length)),
});

describe('island bench — per-framework worker/main split', () => {
  it('measures mount / updateProps / click for every island adapter', async () => {
    const results: {
      id: string;
      label: string;
      scenarios: Record<(typeof SCENARIO_NAMES)[number], Scenario>;
    }[] = [];

    for (const fw of FRAMEWORKS) {
      // Warm-up mount on a SEPARATE client+worker — InProcessWorker shares
      // the module graph, so module eval/first-mount JIT are amortized
      // globally, and each measured worker gets a clean single mount.
      // Svelte warms with 'imp': a second svelteMount in one module graph
      // renders nothing (see svelte-island/test/svelte-double.test.ts), so
      // the measured svelte mount must be the module graph's first.
      const warmHost = realDoc.createElement('div');
      realDoc.body.appendChild(warmHost);
      const warm = await mountIsland({
        client: connectIslandWorker({ worker: renderWorker }),
        el: warmHost,
        app: fw.id === 'svelte' ? 'imp' : fw.id,
        props: { rows: 4, label: 'warm' },
        onOps: () => {},
      });
      warmIslands.push(warm);

      const { client, calls } = instrument(connectIslandWorker({ worker: renderWorker }));
      const batches: BatchTiming[] = [];
      const scenarios = {} as Record<(typeof SCENARIO_NAMES)[number], Scenario>;

      const host = realDoc.createElement('div');
      realDoc.body.appendChild(host);

      const island = await mountIsland({
        client,
        el: host,
        app: fw.id,
        props: { rows: 200, label: 'row' },
        onOps: (ops, ms) => batches.push({ ops, ms }),
      });
      // Svelte (and any async-first-render adapter) commits after mount
      // resolves — wait for the tree, THEN cut the mount measurement.
      await vi.waitFor(() =>
        expect(host.querySelectorAll('.row').length).toBe(200),
      );
      scenarios.mount = measure(calls.splice(0), batches.splice(0));

      await island.updateProps({ rows: 200, label: 'renamed' });
      await vi.waitFor(() =>
        expect(host.querySelector('.cell')?.textContent).toBe('renamed 0'),
      );
      scenarios.update = measure(calls.splice(0), batches.splice(0));

      host.querySelector<HTMLElement>('.inc')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      await vi.waitFor(() =>
        expect(host.querySelector('.inc')?.textContent).toBe('inc 1'),
      );
      scenarios.click = measure(calls.splice(0), batches.splice(0));

      for (const name of SCENARIO_NAMES) {
        const s = scenarios[name];
        const total = s.workerMs + s.mainMs || 1;
        console.log(
          `[bench] ${fw.id}/${name}: worker=${s.workerMs.toFixed(1)}ms ` +
            `main=${s.mainMs.toFixed(1)}ms ops=${s.ops} ` +
            `→ worker share ${((100 * s.workerMs) / total).toFixed(0)}%`,
        );
      }
      results.push({ id: fw.id, label: fw.label, scenarios });
      // Same async-teardown reasoning as the warm islands — destroy at the
      // end so a leaking dispose can't surface inside the next framework's
      // measured tasks.
      warmIslands.push(island);
      host.remove();
    }

    // One parseable line for scripts/island-perf.mjs — the spec stays free
    // of node:fs/process so the package tsconfig needs no node types.
    console.log(
      '[bench-stats]' +
        JSON.stringify({
          generatedAt: new Date().toISOString().slice(0, 10),
          rows: 200,
          results,
        }),
    );
  });
});
