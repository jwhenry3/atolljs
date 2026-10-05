// @vitest-environment happy-dom
/**
 * Audit rules (app/panels/audit-rules.js) over synthetic snapshots: every
 * rule must fire on its signature and stay quiet on healthy data. Plus a
 * smoke test of the panel (app/panels/audits.js) against a stub api.
 */
import { describe, expect, it, vi } from 'vitest';
// @ts-ignore: plain-JS dashboard module (no declarations; the app has no build step)
import * as rules from '../app/panels/audit-rules.js';
// @ts-ignore: plain-JS dashboard module
import * as panel from '../app/panels/audits.js';

type Finding = {
  id: string; rule: string; severity: 'error' | 'warn' | 'info';
  title: string; detail: string; fix: string;
  docs?: { label: string; href: string };
  entities?: { kind: string; key: string; label: string }[];
};
type Snap = Record<string, any>;
const { runAudits, ruleCoverage, RULES } = rules as {
  runAudits: (s: Snap, o?: { muted?: Iterable<string> }) => Finding[];
  ruleCoverage: (s: Snap) => Record<string, boolean>;
  RULES: { id: string; title: string; needs: string }[];
};

const NOW = 200_000;
const SID = 's1';

const session = (over: Snap = {}) => ({
  id: SID, name: 'app', runtime: 'browser',
  env: { crossOriginIsolated: true, sharedArrayBuffer: true, hardwareConcurrency: 8 },
  longframes: [], frames: [], ...over,
});
const pool = (over: Snap = {}) => ({
  key: `${SID}|pool-1`, sid: SID, poolId: 'pool-1', label: 'sla',
  initSeen: true, poolSize: 4, concurrency: 1, dedicated: false,
  firstAt: NOW - 90_000, taskEvents: 100, dispatches: [], runs: [], backlog: 0, backlogSeries: [], ...over,
});
const task = (over: Snap = {}) => ({
  key: `${SID}|pool-1|crunch`, sid: SID, poolId: 'pool-1', taskId: 'crunch',
  settles: [], argBytes: [], resultBytes: [], ...over,
});
const island = (over: Snap = {}) => ({
  key: `${SID}|counter@1`, sid: SID, instance: 'counter@1', app: 'counter', framework: 'react',
  poolId: 'counter-w', mounted: true, ended: false, batches: [], ...over,
});
const worker = (over: Snap = {}) => ({
  key: `${SID}|pool-1|0`, sid: SID, poolId: 'pool-1', slot: 0, respawns: [], ...over,
});
const snap = (over: Snap = {}): Snap => ({
  now: NOW, sessions: [session()], pools: [], tasks: [], workers: [], islands: [], memFields: [], fetches: [], ...over,
});
/** n samples spread over the last ~n seconds. */
const series = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => ({ t: NOW - 1000 * (i + 1), ...f(i) }));
const ofRule = (s: Snap, rule: string) => runAudits(s).filter((f) => f.rule === rule);

describe('audit rules', () => {
  it('a healthy snapshot produces no findings', () => {
    const healthy = snap({
      pools: [pool({
        dispatches: series(40, () => ({ waitMs: 2 })),
        runs: series(40, () => ({ runMs: 800 })),
      })],
      tasks: [task({
        settles: series(40, () => ({ outcome: 'ok' })),
        argBytes: series(10, () => ({ v: 2048 })),
        resultBytes: series(10, () => ({ v: 512 })),
      })],
      islands: [island({ batches: series(10, () => ({ count: 20, bytes: 4000, replayMs: 1 })) })],
      workers: [worker({ heap: 10e6, heapLimit: 100e6 })],
      sessions: [session({ heap: 20e6, heapLimit: 2e9, frames: series(10, () => ({ fps: 60, dropped: 0 })) })],
    });
    expect(runAudits(healthy)).toEqual([]);
  });

  it('every catalogued rule id is unique', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('coi-islands', () => {
    it('fires for mounted islands on a non-isolated browser page', () => {
      const f = ofRule(snap({
        sessions: [session({ env: { crossOriginIsolated: false, sharedArrayBuffer: false } })],
        islands: [island()],
      }), 'coi-islands');
      expect(f).toHaveLength(1);
      expect(f[0].severity).toBe('warn');
      expect(f[0].detail).toContain('no SharedArrayBuffer');
      expect(f[0].fix).toContain("mountIsland({ mode: 'poll' })");
      expect(f[0].fix).toContain('connectIslandWorker({ doorbell: false })');
      expect(f[0].entities?.map((e) => e.kind)).toEqual(['session', 'island']);
    });
    it('stays quiet when isolated, on Node, or with no live islands', () => {
      expect(ofRule(snap({ islands: [island()] }), 'coi-islands')).toEqual([]);
      expect(ofRule(snap({
        sessions: [session({ runtime: 'node', env: { crossOriginIsolated: false } })], islands: [island()],
      }), 'coi-islands')).toEqual([]);
      expect(ofRule(snap({
        sessions: [session({ env: { crossOriginIsolated: false } })], islands: [island({ ended: true })],
      }), 'coi-islands')).toEqual([]);
    });
  });

  describe('large-args / large-results', () => {
    it('fires when p95 or average clone size exceeds 64KB', () => {
      const s = snap({
        pools: [pool()],
        tasks: [task({
          argBytes: series(5, () => ({ v: 200 * 1024 })),
          resultBytes: series(5, (i) => ({ v: i === 0 ? 400 * 1024 : 1024 })),
        })],
      });
      const args = ofRule(s, 'large-args');
      expect(args).toHaveLength(1);
      expect(args[0].detail).toContain('200.0KB');
      expect(args[0].fix).toContain('defineSharedMemory');
      expect(args[0].entities?.[0]).toMatchObject({ kind: 'pool', key: `${SID}|pool-1` });
      expect(ofRule(s, 'large-results')).toHaveLength(1); // avg 82KB > 64KB
    });
    it('stays quiet for small payloads, few samples, or stale samples', () => {
      expect(ofRule(snap({ tasks: [task({ argBytes: series(10, () => ({ v: 1024 })) })] }), 'large-args')).toEqual([]);
      expect(ofRule(snap({ tasks: [task({ argBytes: series(2, () => ({ v: 1e6 })) })] }), 'large-args')).toEqual([]);
      const stale = series(5, () => ({ v: 1e6 })).map((x) => ({ ...x, t: NOW - 120_000 }));
      expect(ofRule(snap({ tasks: [task({ argBytes: stale })] }), 'large-args')).toEqual([]);
    });
  });

  describe('island-batch-bytes / island-slow-replay', () => {
    it('fires on big batches and slow replay', () => {
      const s = snap({ islands: [island({ batches: series(5, () => ({ count: 4000, bytes: 300 * 1024, replayMs: 40 })) })] });
      expect(ofRule(s, 'island-batch-bytes')).toHaveLength(1);
      const r = ofRule(s, 'island-slow-replay');
      expect(r).toHaveLength(1);
      expect(r[0].fix).toContain('onOps');
      expect(r[0].entities?.[0]).toMatchObject({ kind: 'island', key: `${SID}|counter@1` });
    });
    it('stays quiet without bytes/replay data or under thresholds', () => {
      expect(ofRule(snap({ islands: [island({ batches: series(5, () => ({ count: 10 })) })] }), 'island-batch-bytes')).toEqual([]);
      expect(ofRule(snap({ islands: [island({ batches: series(5, () => ({ count: 10, replayMs: 3 })) })] }), 'island-slow-replay')).toEqual([]);
    });
  });

  describe('pool-saturated', () => {
    it('fires when queue wait p95 dominates run p95', () => {
      const f = ofRule(snap({
        pools: [pool({
          dispatches: series(30, () => ({ waitMs: 400 })),
          runs: series(30, () => ({ runMs: 100 })),
        })],
      }), 'pool-saturated');
      expect(f).toHaveLength(1);
      expect(f[0].fix).toContain('connectWorker({ workers: 8 })'); // min(4×2, 8 cores)
      expect(f[0].fix).toContain('maxQueue');
    });
    it('fires on a growing backlog', () => {
      const f = ofRule(snap({
        pools: [pool({ backlog: 50, backlogSeries: series(8, (i) => ({ v: 50 - i * 4 })) })],
      }), 'pool-saturated');
      expect(f).toHaveLength(1);
      expect(f[0].detail).toContain('50 queued calls');
    });
    it('suggests splitting work when the pool already matches the core count', () => {
      const f = ofRule(snap({
        pools: [pool({ poolSize: 8, dispatches: series(30, () => ({ waitMs: 400 })), runs: series(30, () => ({ runMs: 100 })) })],
      }), 'pool-saturated');
      expect(f[0].fix).toContain('Promise.all');
    });
    it('stays quiet for dedicated workers, short waits, or a stable backlog', () => {
      const busy = { dispatches: series(30, () => ({ waitMs: 400 })), runs: series(30, () => ({ runMs: 100 })) };
      expect(ofRule(snap({ pools: [pool({ ...busy, dedicated: true, poolSize: 1 })] }), 'pool-saturated')).toEqual([]);
      expect(ofRule(snap({ pools: [pool({ dispatches: series(30, () => ({ waitMs: 5 })), runs: series(30, () => ({ runMs: 100 })) })] }), 'pool-saturated')).toEqual([]);
      expect(ofRule(snap({ pools: [pool({ backlog: 50, backlogSeries: series(8, () => ({ v: 50 })) })] }), 'pool-saturated')).toEqual([]);
    });
  });

  describe('pool-underused', () => {
    it('fires for a multi-worker pool that is almost idle', () => {
      const f = ofRule(snap({ pools: [pool({ runs: series(5, () => ({ runMs: 10 })) })] }), 'pool-underused');
      expect(f).toHaveLength(1);
      expect(f[0].severity).toBe('info');
      expect(f[0].fix).toContain('connectWorker({ workers: 1 })');
    });
    it('stays quiet when busy, single-worker, dedicated, or observed too briefly', () => {
      expect(ofRule(snap({ pools: [pool({ runs: series(50, () => ({ runMs: 1000 })) })] }), 'pool-underused')).toEqual([]);
      expect(ofRule(snap({ pools: [pool({ poolSize: 1 })] }), 'pool-underused')).toEqual([]);
      expect(ofRule(snap({ pools: [pool({ dedicated: true })] }), 'pool-underused')).toEqual([]);
      expect(ofRule(snap({ pools: [pool({ firstAt: NOW - 5_000 })] }), 'pool-underused')).toEqual([]);
    });
  });

  describe('pool-oversized', () => {
    it('fires when workers exceed hardwareConcurrency', () => {
      const f = ofRule(snap({ pools: [pool({ poolSize: 16, runs: series(50, () => ({ runMs: 1000 })) })] }), 'pool-oversized');
      expect(f).toHaveLength(1);
      expect(f[0].fix).toContain("connectWorker({ workers: 'auto' })");
    });
    it('stays quiet within core count or without the env fact', () => {
      expect(ofRule(snap({ pools: [pool({ poolSize: 8 })] }), 'pool-oversized')).toEqual([]);
      expect(ofRule(snap({ sessions: [session({ env: {} })], pools: [pool({ poolSize: 16 })] }), 'pool-oversized')).toEqual([]);
    });
  });

  describe('main-jank / low-fps', () => {
    it('fires on total blocking time, escalating to error', () => {
      const lf = (n: number, blockingMs: number) =>
        series(n, () => ({ ms: blockingMs + 50, blockingMs, scripts: [{ src: 'app.js', fn: 'renderAll', ms: blockingMs }] }));
      const warn = ofRule(snap({ sessions: [session({ longframes: lf(4, 100) })] }), 'main-jank');
      expect(warn).toHaveLength(1);
      expect(warn[0].severity).toBe('warn');
      expect(warn[0].detail).toContain('renderAll @ app.js');
      const err = ofRule(snap({ sessions: [session({ longframes: lf(10, 150) })] }), 'main-jank');
      expect(err[0].severity).toBe('error');
    });
    it('keeps hidden-page frames out of main-jank and reports them as background-work', () => {
      const hidden = series(10, () => ({ ms: 1000, blockingMs: 150, scripts: [{ src: 'poll.js', fn: 'tick', ms: 200 }], hidden: true }));
      const s = snap({ sessions: [session({ longframes: hidden })] });
      expect(ofRule(s, 'main-jank')).toEqual([]);
      const bg = ofRule(s, 'background-work');
      expect(bg).toHaveLength(1);
      expect(bg[0].severity).toBe('info');
      const few = series(2, () => ({ ms: 1000, blockingMs: 100, scripts: [{ ms: 150 }], hidden: true }));
      expect(ofRule(snap({ sessions: [session({ longframes: few })] }), 'background-work')).toEqual([]);
    });
    it('fires on low average fps', () => {
      const f = ofRule(snap({ sessions: [session({ frames: series(5, () => ({ fps: 30, dropped: 10 })) })] }), 'low-fps');
      expect(f).toHaveLength(1);
      expect(f[0].detail).toContain('50 dropped frames');
    });
    it('stays quiet for a few short blocks and smooth frames', () => {
      expect(ofRule(snap({ sessions: [session({ longframes: series(2, () => ({ ms: 80, blockingMs: 30 })) })] }), 'main-jank')).toEqual([]);
      expect(ofRule(snap({ sessions: [session({ frames: series(5, () => ({ fps: 59, dropped: 0 })) })] }), 'low-fps')).toEqual([]);
      expect(ofRule(snap({ sessions: [session({ frames: series(2, () => ({ fps: 10, dropped: 0 })) })] }), 'low-fps')).toEqual([]);
    });
  });

  describe('task-errors / task-timeouts / queue-full', () => {
    it('fires on error rate (error at ≥50%) and timeouts', () => {
      const s = snap({
        pools: [pool()],
        tasks: [task({
          settles: series(10, (i) => i < 6
            ? { outcome: 'error', error: 'bad input' }
            : i < 8 ? { outcome: 'timeout' } : { outcome: 'ok' }),
        })],
      });
      const e = ofRule(s, 'task-errors');
      expect(e).toHaveLength(1);
      expect(e[0].severity).toBe('error');
      expect(e[0].detail).toContain('"bad input"');
      const t = ofRule(s, 'task-timeouts');
      expect(t).toHaveLength(1);
      expect(t[0].fix).toContain('client.with({ timeout })');
    });
    it('groups queue-full rejections per pool', () => {
      const f = ofRule(snap({
        pools: [pool()],
        tasks: [
          task({ settles: series(2, () => ({ outcome: 'queue-full' })) }),
          task({ key: `${SID}|pool-1|other`, taskId: 'other', settles: series(1, () => ({ outcome: 'queue-full' })) }),
        ],
      }), 'queue-full');
      expect(f).toHaveLength(1);
      expect(f[0].title).toContain('3 calls');
      expect(f[0].fix).toContain('PoolQueueFullError');
    });
    it('stays quiet below rate thresholds, with few samples, and ignores aborts', () => {
      expect(ofRule(snap({ tasks: [task({ settles: series(20, (i) => ({ outcome: i === 0 ? 'error' : 'ok' })) })] }), 'task-errors')).toEqual([]);
      expect(ofRule(snap({ tasks: [task({ settles: series(3, () => ({ outcome: 'error' })) })] }), 'task-errors')).toEqual([]);
      expect(ofRule(snap({ tasks: [task({ settles: series(10, () => ({ outcome: 'aborted' })) })] }), 'task-errors')).toEqual([]);
      expect(ofRule(snap({ tasks: [task({ settles: series(10, () => ({ outcome: 'ok' })) })] }), 'queue-full')).toEqual([]);
    });
  });

  describe('crash-loop', () => {
    it('fires on repeated respawns of one slot', () => {
      const f = ofRule(snap({
        workers: [worker({ respawns: [NOW - 30_000, NOW - 20_000, NOW - 1_000], lastError: 'boom' })],
      }), 'crash-loop');
      expect(f).toHaveLength(1);
      expect(f[0].severity).toBe('error');
      expect(f[0].fix).toContain('respawn: false');
      expect(f[0].entities?.[0]).toMatchObject({ kind: 'worker', key: `${SID}|pool-1|0`, label: 'pool-1#0' });
    });
    it('stays quiet for spread-out respawns', () => {
      expect(ofRule(snap({ workers: [worker({ respawns: [NOW - 150_000, NOW - 90_000, NOW - 1_000] })] }), 'crash-loop')).toEqual([]);
    });
  });

  describe('heap-pressure', () => {
    it('fires for workers and sessions above 80%, error above 95%', () => {
      const s = snap({
        workers: [worker({ heap: 85, heapLimit: 100 })],
        sessions: [session({ heap: 97, heapLimit: 100 })],
      });
      const f = ofRule(s, 'heap-pressure');
      expect(f.map((x) => x.severity).sort()).toEqual(['error', 'warn']);
      expect(f.find((x) => x.severity === 'warn')?.entities?.[0].kind).toBe('worker');
    });
    it('stays quiet below 80% or without a limit', () => {
      expect(ofRule(snap({ workers: [worker({ heap: 50, heapLimit: 100 }), worker({ key: 'x', heap: 99 })] }), 'heap-pressure')).toEqual([]);
    });
  });

  describe('devtools-late', () => {
    it('fires for task traffic on a pool with no pool:init', () => {
      const f = ofRule(snap({ pools: [pool({ initSeen: false, poolSize: undefined, taskEvents: 12 })] }), 'devtools-late');
      expect(f).toHaveLength(1);
      expect(f[0].fix).toContain('initDevtools()');
      expect(f[0].docs?.href).toContain('devtools.md#invariants');
    });
    it('stays quiet once pool:init was seen', () => {
      expect(ofRule(snap({ pools: [pool()] }), 'devtools-late')).toEqual([]);
    });
  });

  describe('memory-write-storm', () => {
    const cur = Math.floor(NOW / 1000) * 1000;
    const field = (perSec: { t: number; v: number }[]) => ({ key: `${SID}|signals.tick`, sid: SID, path: 'signals.tick', perSec });
    it('fires above 1000 writes/s averaged over 5s', () => {
      const f = ofRule(snap({ memFields: [field([1, 2, 3, 4, 5].map((i) => ({ t: cur - i * 1000, v: 2000 })))] }), 'memory-write-storm');
      expect(f).toHaveLength(1);
      expect(f[0].detail).toContain('2000 writes/s');
      expect(f[0].fix).toContain('commit()');
    });
    it('stays quiet for moderate rates and ignores the partial current second', () => {
      expect(ofRule(snap({ memFields: [field([1, 2, 3].map((i) => ({ t: cur - i * 1000, v: 60 })))] }), 'memory-write-storm')).toEqual([]);
      expect(ofRule(snap({ memFields: [field([{ t: cur, v: 50_000 }])] }), 'memory-write-storm')).toEqual([]);
    });
  });

  describe('fetch-failing / fetch-slow', () => {
    const fetch = (over: Snap) => ({ sid: SID, t: NOW - 1000, url: '/api/items?page=1', method: 'GET', status: 200, ms: 40, ...over });
    it('groups failures and slow requests by method + path', () => {
      const s = snap({
        fetches: [
          fetch({ status: 500 }), fetch({ url: '/api/items?page=2', status: 502 }), fetch({ status: undefined, error: 'Failed to fetch' }),
          fetch({ url: '/slow', ms: 3000 }), fetch({ url: '/slow', ms: 3500 }), fetch({ url: '/slow', ms: 2500 }),
        ],
      });
      const f = ofRule(s, 'fetch-failing');
      expect(f).toHaveLength(1);
      expect(f[0].title).toContain('GET /api/items');
      expect(f[0].detail).toContain('500, 502');
      expect(f[0].detail).toContain('Failed to fetch');
      expect(ofRule(s, 'fetch-slow')).toHaveLength(1);
    });
    it('stays quiet for fast successful requests', () => {
      expect(runAudits(snap({ fetches: [fetch({}), fetch({}), fetch({})] }))).toEqual([]);
    });
  });

  describe('island-untagged', () => {
    it('fires once per session listing untagged live islands', () => {
      const f = ofRule(snap({
        islands: [island({ framework: undefined }), island({ key: `${SID}|vanilla@2`, instance: 'vanilla@2', framework: undefined })],
      }), 'island-untagged');
      expect(f).toHaveLength(1);
      expect(f[0].severity).toBe('info');
      expect(f[0].entities).toHaveLength(2);
    });
    it('stays quiet for tagged or ended islands', () => {
      expect(ofRule(snap({ islands: [island(), island({ key: 'x', instance: 'x@1', framework: undefined, ended: true })] }), 'island-untagged')).toEqual([]);
    });
  });

  it('sorts by severity, honours muted rules, and keeps ids stable', () => {
    const s = snap({
      workers: [worker({ respawns: [NOW - 3000, NOW - 2000, NOW - 1000] })],
      islands: [island({ framework: undefined })],
      pools: [pool({ poolSize: 16, runs: series(50, () => ({ runMs: 1000 })) })],
    });
    const all = runAudits(s);
    expect(all.map((f) => f.severity)).toEqual(['error', 'warn', 'info']);
    expect(runAudits(s).map((f) => f.id)).toEqual(all.map((f) => f.id));
    expect(runAudits(s, { muted: ['crash-loop'] }).map((f) => f.rule)).toEqual(['pool-oversized', 'island-untagged']);
  });

  it('ruleCoverage reports which rules have their input data', () => {
    const cov = ruleCoverage(snap({ tasks: [task({ argBytes: series(1, () => ({ v: 1 })) })] }));
    expect(cov['large-args']).toBe(true);
    expect(cov['large-results']).toBe(false);
    expect(cov['main-jank']).toBe(false);
    expect(Object.keys(cov).sort()).toEqual(RULES.map((r) => r.id).sort());
  });
});

describe('audits panel', () => {
  const stubApi = () => {
    const hooks: Record<string, ((...a: any[]) => void)[]> = { event: [], tick: [], render: [], reset: [], reconcile: [] };
    const views: any[] = [];
    const opened: string[] = [];
    const api: any = {
      hooks,
      onEvent: (fn: any) => hooks.event.push(fn),
      onTick: (fn: any) => hooks.tick.push(fn),
      onRender: (fn: any) => hooks.render.push(fn),
      onReset: (fn: any) => hooks.reset.push(fn),
      onReconcile: (fn: any) => hooks.reconcile.push(fn),
      state: { sessions: new Map(), sel: null, workers: new Map(), inspect: null, inspectWorker: null },
      inSel: () => true,
      esc: (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)),
      kpi: (v: unknown, l: string) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`,
      palette: [] as any[],
      addPaletteItem(item: any) { this.palette.push(item); },
      addView(v: any) {
        const section = document.createElement('section');
        section.className = 'view on';
        section.id = `view-${v.id}`;
        section.innerHTML = v.html;
        document.body.appendChild(section);
        views.push({ ...v, section });
        return section;
      },
      openView: (id: string) => opened.push(id),
      openSub: (view: string, sub: string) => opened.push(`${view}/${sub}`),
      render: () => {},
    };
    return { api, views, opened };
  };

  it('ingests events, badges warn+error findings, opens inspectors, and mutes rules', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const { api, views, opened } = stubApi();
    const sess = { id: 's1', name: 'app', runtime: 'browser', env: { crossOriginIsolated: true, hardwareConcurrency: 8 } };
    api.state.sessions.set('s1', sess);
    panel.setup(api);
    const view = views.find((v) => v.id === 'audits');
    expect(view.order).toBe(80);
    expect(view.badge()).toBeNull();
    api.hooks.render.forEach((h: any) => h());
    expect(view.section.textContent).toContain('No issues found');
    expect(api.palette.map((p: any) => p.title)).toContain('Audits: show issues');

    const emit = (e: any) => api.hooks.event.forEach((h: any) => h(sess, e));
    emit({ type: 'pool:init', poolId: 'big-p', label: 'big', poolSize: 16, concurrency: 1 });
    for (let i = 0; i < 3; i++) emit({ type: 'worker:respawn', poolId: 'big-p', slot: 2 });
    api.hooks.tick.forEach((h: any) => h());

    expect(view.badge()).toBe(2); // crash-loop (error) + pool-oversized (warn)
    const text = view.section.textContent;
    expect(text).toContain('crash-looping');
    expect(text).toContain('more workers than cores');

    const chip = view.section.querySelector('.au-chip[data-kind="worker"]') as HTMLButtonElement;
    expect(chip.dataset.key).toBe('s1|big-p|2');
    chip.click();
    expect(api.state.inspectWorker).toBe('s1|big-p|2');
    expect(opened).toContain('dashboard/tv-worker');

    (view.section.querySelector('[data-mute="crash-loop"]') as HTMLButtonElement).click();
    expect(view.badge()).toBe(1);
    expect(JSON.parse(localStorage.getItem('atoll.devtools.audits.muted')!)).toEqual(['crash-loop']);
    expect(view.section.querySelector('#auMuted')!.textContent).toContain('Worker crash loop');
    (view.section.querySelector('[data-unmute="crash-loop"]') as HTMLButtonElement).click();
    expect(view.badge()).toBe(2);

    api.hooks.reset.forEach((h: any) => h());
    api.hooks.tick.forEach((h: any) => h());
    expect(view.badge()).toBeNull();
  });
});
