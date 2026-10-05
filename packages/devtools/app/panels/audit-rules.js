// Audit rules for the devtools dashboard: a PURE module (no DOM, no api,
// no clock reads). `runAudits(snapshot)` turns windowed aggregates into
// findings; ./audits.js builds the snapshot from the live event stream and
// renders the result. Tests feed synthetic snapshots straight in.
//
// Time basis: every `t` in a snapshot is the DASHBOARD clock
// (performance.now() at ingest), never an event's `at` — emit threads have
// unrelated performance.now() epochs, so rate windows only make sense on
// the receiving clock. `snapshot.now` is that clock at snapshot time.

/**
 * @typedef {'error' | 'warn' | 'info'} Severity
 * @typedef {{ kind: 'worker' | 'island' | 'pool' | 'session', key: string, label: string }} Entity
 * @typedef {{
 *   id: string, rule: string, severity: Severity, title: string, detail: string,
 *   fix: string, docs?: { label: string, href: string }, entities?: Entity[],
 * }} Finding
 *
 * @typedef {{ t: number, v: number }} Sample            dashboard-clock sample
 * @typedef {{
 *   id: string, name?: string, runtime?: 'browser' | 'node', closed?: boolean,
 *   env?: { crossOriginIsolated?: boolean, sharedArrayBuffer?: boolean,
 *           hardwareConcurrency?: number, userAgent?: string, node?: string },
 *   heap?: number, heapLimit?: number,
 *   longframes: { t: number, ms: number, blockingMs: number, scripts?: { src?: string, fn?: string, ms: number }[], hidden?: boolean }[],
 *   frames: { t: number, fps: number, dropped: number }[],
 * }} SessionAgg
 * @typedef {{
 *   key: string, sid: string, poolId: string, label?: string,
 *   initSeen: boolean, poolSize?: number, concurrency?: number, dedicated?: boolean,
 *   dead?: boolean, firstAt: number, taskEvents: number,
 *   dispatches: { t: number, waitMs: number }[],
 *   runs: { t: number, runMs: number }[],
 *   backlog: number, backlogSeries: Sample[],
 * }} PoolAgg                                           key = `${sid}|${poolId}`
 * @typedef {{
 *   key: string, sid: string, poolId: string, taskId: string,
 *   settles: { t: number, outcome: string, error?: string }[],
 *   argBytes: Sample[], resultBytes: Sample[],
 * }} TaskAgg                                           key = `${sid}|${poolId}|${taskId}`
 * @typedef {{
 *   key: string, sid: string, poolId: string, slot: number,
 *   respawns: number[], heap?: number, heapLimit?: number, lastError?: string,
 * }} WorkerAgg                                         key = `${sid}|${poolId}|${slot}`
 * @typedef {{
 *   key: string, sid: string, instance: string, app?: string, framework?: string,
 *   poolId?: string, mounted: boolean, ended: boolean,
 *   batches: { t: number, count: number, bytes?: number, replayMs?: number }[],
 * }} IslandAgg                                         key = `${sid}|${instance}`
 * @typedef {{ key: string, sid: string, path: string, perSec: Sample[] }} MemFieldAgg
 *                                                      perSec: t = second start (ms), v = writes
 * @typedef {{ sid: string, t: number, url: string, method: string, status?: number, ms: number, error?: string }} FetchAgg
 * @typedef {{
 *   now: number, sessions: SessionAgg[], pools: PoolAgg[], tasks: TaskAgg[],
 *   workers: WorkerAgg[], islands: IslandAgg[], memFields: MemFieldAgg[], fetches: FetchAgg[],
 * }} AuditSnapshot
 */

/* ── thresholds ──────────────────────────────────────────────────────────── */

/** Default analysis window: most rules look at the last 60s of live data. */
export const WINDOW_MS = 60_000;
/** Task args/results whose p95 or average clone size exceeds this are "large". */
export const LARGE_MESSAGE_BYTES = 64 * 1024;
/** Calls needed before a payload-size verdict. */
export const MIN_MESSAGE_SAMPLES = 3;
/** Island op batches (estimated clone bytes, p95) above this are "large". */
export const ISLAND_BATCH_BYTES = 128 * 1024;
/** Main-thread replay p95 above one 60Hz frame budget is "slow". */
export const ISLAND_REPLAY_MS = 16;
/** Batches needed before an island batch verdict. */
export const MIN_ISLAND_BATCHES = 3;
/** Saturation: queue wait p95 must exceed this AND the run p95. */
export const SATURATION_WAIT_MS = 50;
/** Dispatches needed before a wait-vs-run verdict. */
export const MIN_DISPATCHES = 20;
/** Saturation: a backlog at least this deep that grew by BACKLOG_GROWTH… */
export const BACKLOG_MIN = 20;
export const BACKLOG_GROWTH = 10;
/** …over this window. */
export const BACKLOG_WINDOW_MS = 10_000;
/** Underused: busy fraction (sum runMs / observed time × workers) below this. */
export const UNDERUSED_UTILIZATION = 0.05;
/** Underused: the pool must have been observed at least this long. */
export const UNDERUSED_MIN_OBSERVED_MS = 30_000;
/** Total blocking time in the window: warn at / error at. */
export const TBT_WARN_MS = 300;
export const TBT_ERROR_MS = 1000;
/** Background work: script ms in hidden-page long frames over the window. */
export const BG_WORK_MS = 1000;
/** Low fps: average below this over FPS_WINDOW_MS (needs MIN_FPS_SAMPLES). */
export const LOW_FPS = 45;
export const FPS_WINDOW_MS = 10_000;
export const MIN_FPS_SAMPLES = 3;
/** Error rate (error + crashed) per task id: warn at / error at. */
export const ERROR_RATE_WARN = 0.1;
export const ERROR_RATE_ERROR = 0.5;
/** Timeout rate per task id: warn at. */
export const TIMEOUT_RATE_WARN = 0.05;
/** Settled calls needed before a rate verdict. */
export const MIN_SETTLES = 5;
/** Crash loop: this many respawns of one slot within CRASH_LOOP_WINDOW_MS. */
export const CRASH_LOOP_RESPAWNS = 3;
export const CRASH_LOOP_WINDOW_MS = 60_000;
/** Heap usage / limit: warn at / error at. */
export const HEAP_WARN = 0.8;
export const HEAP_ERROR = 0.95;
/** Write storm: average writes/s for one field over WRITE_STORM_WINDOW_MS. */
export const WRITE_STORM_PER_SEC = 1000;
export const WRITE_STORM_WINDOW_MS = 5_000;
/** Slow fetches: p95 above this (needs MIN_FETCHES). */
export const FETCH_SLOW_MS = 2000;
export const MIN_FETCHES = 3;

/* ── docs links (GitHub blobs of this repo's docs/*.md) ──────────────────── */

const GH = 'https://github.com/jwhenry3/atolljs/blob/main/docs/';
const DOCS = {
  coi: { label: 'Cross-origin isolation', href: `${GH}cross-origin-isolation.md` },
  sharedMemory: { label: 'Shared memory contracts', href: `${GH}shared-memory.md` },
  connectors: { label: 'Shared memory: connectors', href: `${GH}shared-memory.md#connectors` },
  islands: { label: 'Islands', href: `${GH}islands.md` },
  islandOptions: { label: 'mountIsland options', href: `${GH}islands.md#mountisland-options` },
  howMany: { label: 'How many workers', href: `${GH}tasks-and-pool.md#how-many-workers` },
  config: { label: 'connectWorker config', href: `${GH}tasks-and-pool.md#connectworker-config` },
  tasks: { label: 'Worker pool & tasks', href: `${GH}tasks-and-pool.md` },
  devtoolsInvariants: { label: 'Devtools: invariants', href: `${GH}devtools.md#invariants` },
};

/* ── rule catalog (the UI's "what data each rule needs" list) ───────────── */

/** @type {{ id: string, title: string, needs: string }[]} */
export const RULES = [
  { id: 'coi-islands', title: 'Islands on a non-isolated page', needs: 'session env.crossOriginIsolated (hello) + island:mount' },
  { id: 'large-args', title: 'Large task arguments', needs: 'task:dispatch argBytes' },
  { id: 'large-results', title: 'Large task results', needs: 'task:settle resultBytes' },
  { id: 'island-batch-bytes', title: 'Large island op batches', needs: 'island:ops bytes' },
  { id: 'island-slow-replay', title: 'Slow island replay', needs: 'island:ops replayMs' },
  { id: 'pool-saturated', title: 'Pool saturation', needs: 'task:dispatch waitMs, task:settle runMs, task:enqueue/dispatch backlog' },
  { id: 'pool-underused', title: 'Underused pool', needs: 'pool:init poolSize + task:settle runMs over ≥30s' },
  { id: 'pool-oversized', title: 'More workers than cores', needs: 'pool:init poolSize + session env.hardwareConcurrency' },
  { id: 'main-jank', title: 'Main-thread blocking', needs: 'runtime:longframe (visible page)' },
  { id: 'background-work', title: 'Heavy work while hidden', needs: 'runtime:longframe hidden' },
  { id: 'low-fps', title: 'Low frame rate', needs: 'runtime:frames' },
  { id: 'task-errors', title: 'High task error rate', needs: 'task:settle outcome' },
  { id: 'task-timeouts', title: 'Task timeouts', needs: 'task:settle outcome' },
  { id: 'queue-full', title: 'Queue-full rejections', needs: "task:settle outcome 'queue-full'" },
  { id: 'crash-loop', title: 'Worker crash loop', needs: 'worker:respawn' },
  { id: 'heap-pressure', title: 'Heap near limit', needs: 'runtime:memory heapLimitBytes (Chromium performance.memory)' },
  { id: 'devtools-late', title: 'Pool spawned before devtools', needs: 'task:* without pool:init' },
  { id: 'memory-write-storm', title: 'Shared-memory write storm', needs: 'memory:write' },
  { id: 'fetch-failing', title: 'Failing requests', needs: 'net:fetch status/error' },
  { id: 'fetch-slow', title: 'Slow requests', needs: 'net:fetch ms' },
  { id: 'island-untagged', title: 'Island without a framework tag', needs: 'island:mount framework' },
];

/* ── helpers ─────────────────────────────────────────────────────────────── */

const SEV_ORDER = { error: 0, warn: 1, info: 2 };

/** Nearest-rank percentile; undefined for an empty list. */
export function percentile(values, p) {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const within = (arr, now, ms) => arr.filter((x) => now - x.t <= ms);

export const fmtBytes = (b) =>
  b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)}MB` : b >= 1024 ? `${(b / 1024).toFixed(1)}KB` : `${Math.round(b)}B`;
const ms = (n) => `${n >= 100 ? Math.round(n) : n.toFixed(1)}ms`;
const pct = (f) => `${Math.round(f * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : /(s|x|z|ch|sh)$/.test(word) ? 'es' : 's'}`;

const poolLabel = (p) => (p?.label && p.label !== p.poolId ? `${p.label} (${p.poolId})` : p?.poolId ?? '?');
const sessLabel = (s) => s?.name ?? s?.id ?? '?';

const poolEntity = (sid, poolId, label) => ({ kind: 'pool', key: `${sid}|${poolId}`, label: label ?? poolId });
const sessionEntity = (s) => ({ kind: 'session', key: s.id, label: sessLabel(s) });

/* ── rules ───────────────────────────────────────────────────────────────── */

/**
 * Run every rule over a snapshot. Findings sort error → warn → info, then
 * by rule order. `opts.muted` (Set or array of rule ids) drops those rules.
 * @param {AuditSnapshot} snap
 * @param {{ muted?: Iterable<string> }} [opts]
 * @returns {Finding[]}
 */
export function runAudits(snap, opts = {}) {
  const muted = new Set(opts.muted ?? []);
  const now = snap.now;
  const sessions = new Map((snap.sessions ?? []).map((s) => [s.id, s]));
  const pools = new Map((snap.pools ?? []).map((p) => [p.key, p]));
  const out = [];
  const add = (f) => { if (!muted.has(f.rule)) out.push(f); };

  /* coi-islands ─ islands mounted on a page without crossOriginIsolated */
  for (const s of sessions.values()) {
    if (s.runtime === 'node' || s.env?.crossOriginIsolated !== false) continue;
    const live = (snap.islands ?? []).filter((i) => i.sid === s.id && i.mounted && !i.ended);
    if (!live.length) continue;
    const noSab = s.env.sharedArrayBuffer === false;
    add({
      id: `coi-islands:${s.id}`,
      rule: 'coi-islands',
      severity: 'warn',
      title: `${plural(live.length, 'island')} polling: page is not cross-origin isolated`,
      detail:
        `${sessLabel(s)} reports crossOriginIsolated = false${noSab ? ' and no SharedArrayBuffer' : ''} with ` +
        `${plural(live.length, 'mounted island')} (${live.slice(0, 6).map((i) => i.instance).join(', ')}${live.length > 6 ? ', …' : ''}). ` +
        'The push doorbell needs SharedArrayBuffer, so these islands drain ops on the 50ms poll, and no pool on this page ' +
        'can bind a defineSharedMemory contract.',
      fix:
        'Serve the page with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` ' +
        '(worker script responses need the same COEP; hosts that cannot set headers can use a header-injecting service worker). ' +
        "If isolation is not possible, make the fallback explicit: `mountIsland({ mode: 'poll' })` or " +
        '`connectIslandWorker({ doorbell: false })`.',
      docs: DOCS.coi,
      entities: [sessionEntity(s), ...live.slice(0, 8).map((i) => ({ kind: 'island', key: i.key, label: i.instance }))],
    });
  }

  /* large-args / large-results ─ per task id payload size */
  for (const t of snap.tasks ?? []) {
    const p = pools.get(`${t.sid}|${t.poolId}`);
    for (const [rule, series, what] of [
      ['large-args', t.argBytes, 'arguments'],
      ['large-results', t.resultBytes, 'results'],
    ]) {
      const vals = within(series ?? [], now, WINDOW_MS).map((x) => x.v);
      if (vals.length < MIN_MESSAGE_SAMPLES) continue;
      const p95 = percentile(vals, 95);
      const mean = avg(vals);
      if (p95 <= LARGE_MESSAGE_BYTES && mean <= LARGE_MESSAGE_BYTES) continue;
      add({
        id: `${rule}:${t.key}`,
        rule,
        severity: 'warn',
        title: `Large ${what} for task "${t.taskId}"`,
        detail:
          `p95 ${fmtBytes(p95)}, avg ${fmtBytes(mean)}, max ${fmtBytes(Math.max(...vals))} over ${plural(vals.length, 'call')} ` +
          `in the last ${WINDOW_MS / 1000}s on ${poolLabel(p ?? { poolId: t.poolId })} (threshold ${fmtBytes(LARGE_MESSAGE_BYTES)}). ` +
          `Every call structured-clones these ${what} across postMessage.`,
        fix:
          'Keep bulk data in shared memory: declare it in a `defineSharedMemory` contract (e.g. `field.float64Array({ length })` ' +
          'or `field.list({ schema, count })`), pass it as `connectWorker({ sharedMemory })`, and ' +
          (what === 'arguments'
            ? 'send only ids/indices as task arguments.'
            : 'have the worker write its output into the contract and return a small summary.'),
        docs: DOCS.sharedMemory,
        entities: [poolEntity(t.sid, t.poolId, p?.label)],
      });
    }
  }

  /* island-batch-bytes / island-slow-replay */
  for (const i of snap.islands ?? []) {
    const recent = within(i.batches ?? [], now, WINDOW_MS);
    const ent = [{ kind: 'island', key: i.key, label: i.instance }];
    const bytes = recent.filter((b) => b.bytes !== undefined).map((b) => b.bytes);
    if (bytes.length >= MIN_ISLAND_BATCHES) {
      const p95 = percentile(bytes, 95);
      if (p95 > ISLAND_BATCH_BYTES) {
        add({
          id: `island-batch-bytes:${i.key}`,
          rule: 'island-batch-bytes',
          severity: 'warn',
          title: `Large op batches from island ${i.instance}`,
          detail:
            `p95 batch ${fmtBytes(p95)} (max ${fmtBytes(Math.max(...bytes))}) over ${plural(bytes.length, 'batch')}, ` +
            `${Math.round(avg(recent.map((b) => b.count)))} ops per batch on average (threshold ${fmtBytes(ISLAND_BATCH_BYTES)}). ` +
            'Op batches always ride postMessage, even with the doorbell.',
          fix:
            'Render less per commit: window long lists (mount only visible rows), avoid rebuilding whole subtrees on ' +
            '`updateProps`, and keep bulk data in the worker (or a `defineSharedMemory` contract) instead of serializing it into the DOM.',
          docs: DOCS.islands,
          entities: ent,
        });
      }
    }
    const replay = recent.filter((b) => b.replayMs !== undefined).map((b) => b.replayMs);
    if (replay.length >= MIN_ISLAND_BATCHES) {
      const p95 = percentile(replay, 95);
      if (p95 > ISLAND_REPLAY_MS) {
        add({
          id: `island-slow-replay:${i.key}`,
          rule: 'island-slow-replay',
          severity: 'warn',
          title: `Slow main-thread replay for island ${i.instance}`,
          detail:
            `Replay p95 ${ms(p95)} (max ${ms(Math.max(...replay))}) over ${plural(replay.length, 'batch')}, ` +
            `${Math.round(avg(recent.map((b) => b.count)))} ops per batch on average: over the ${ISLAND_REPLAY_MS}ms frame budget.`,
          fix:
            'Replay cost scales with op count: emit fewer DOM mutations per commit (windowed lists, stable keys, no full re-renders ' +
            'on `updateProps`). `mountIsland({ onOps: (ops, elapsedMs) => … })` reports per-batch replay cost while you tune.',
          docs: DOCS.islandOptions,
          entities: ent,
        });
      }
    }
  }

  /* pool rules: saturation, underuse, oversize, devtools-late */
  for (const p of pools.values()) {
    const s = sessions.get(p.sid);
    const ent = [poolEntity(p.sid, p.poolId, p.label)];
    const hc = s?.env?.hardwareConcurrency;

    if (!p.initSeen && p.taskEvents > 0) {
      add({
        id: `devtools-late:${p.key}`,
        rule: 'devtools-late',
        severity: 'warn',
        title: `Pool ${p.poolId} was spawned before devtools was enabled`,
        detail:
          `${plural(p.taskEvents, 'task event')} for ${p.poolId} but no pool:init. Its workers received devtools: false in the ` +
          'INIT handshake, so worker-side events (heap, fetches, memory writes, logs) never forward. ' +
          "(Also seen when the dashboard joined after the app's replay tail dropped pool:init.)",
        fix:
          'Call `initDevtools()` before any pool spawns: in the browser, before the first task call (or `start()`) on any ' +
          "client; in Node, from a module imported first by the entry (`import './devtools'`), since ESM evaluates imports before the entry body.",
        docs: DOCS.devtoolsInvariants,
        entities: [...ent, ...(s ? [sessionEntity(s)] : [])],
      });
    }
    if (!p.initSeen || p.dead) continue;
    const size = p.poolSize ?? 0;

    if (hc && size > hc) {
      add({
        id: `pool-oversized:${p.key}`,
        rule: 'pool-oversized',
        severity: 'warn',
        title: `Pool ${poolLabel(p)} has more workers than cores`,
        detail: `${size} workers on a machine reporting hardwareConcurrency = ${hc}. Extra workers contend for the same cores and each carries its own heap.`,
        fix: `Use \`connectWorker({ workers: 'auto' })\` (navigator.hardwareConcurrency) or a count ≤ ${hc}.`,
        docs: DOCS.howMany,
        entities: ent,
      });
    }

    if (p.dedicated) continue; // no queue: waitMs is always 0, utilization of one thread is not a sizing signal

    const disp = within(p.dispatches ?? [], now, WINDOW_MS);
    const runs = within(p.runs ?? [], now, WINDOW_MS);
    const waitP95 = percentile(disp.map((d) => d.waitMs), 95) ?? 0;
    const runP95 = percentile(runs.map((r) => r.runMs), 95) ?? 0;
    const series = within(p.backlogSeries ?? [], now, BACKLOG_WINDOW_MS);
    const growth = series.length ? p.backlog - Math.min(...series.map((x) => x.v)) : 0;
    const waitSat = disp.length >= MIN_DISPATCHES && waitP95 > SATURATION_WAIT_MS && waitP95 > runP95;
    const backlogSat = p.backlog >= BACKLOG_MIN && growth >= BACKLOG_GROWTH;
    if (waitSat || backlogSat) {
      const conc = p.concurrency ?? 1;
      const suggest = hc ? Math.min(size * 2, hc) : size * 2;
      const atCores = hc !== undefined && size >= hc;
      add({
        id: `pool-saturated:${p.key}`,
        rule: 'pool-saturated',
        severity: 'warn',
        title: `Pool ${poolLabel(p)} is saturated`,
        detail:
          (disp.length
            ? `Queue wait p95 ${ms(waitP95)} vs run p95 ${ms(runP95)} over ${plural(disp.length, 'dispatch')} in the last ${WINDOW_MS / 1000}s. `
            : '') +
          `Backlog: ${plural(p.backlog, 'queued call')}${growth > 0 ? ` (+${growth} in ${BACKLOG_WINDOW_MS / 1000}s)` : ''}. ` +
          `${size} workers × concurrency ${conc}.`,
        fix: atCores
          ? `The pool already matches the ${hc} reported cores, so more workers won't speed up CPU-bound tasks: shorten each task or ` +
            'split work into more, smaller calls (a pool never splits one call; fan out with `Promise.all`). If tasks await I/O, raise ' +
            '`concurrency`. Bound the queue with `maxQueue` so overload rejects fast (`PoolQueueFullError`).'
          : `Add workers: \`connectWorker({ workers: ${suggest} })\`${hc ? ` (${hc} cores reported; \`'auto'\` uses navigator.hardwareConcurrency)` : ''}. ` +
            `If tasks await I/O, raise \`concurrency\` (in-flight cap per worker, now ${conc}). Bound the queue with \`maxQueue\` ` +
            'so overload rejects fast (`PoolQueueFullError`) instead of growing.',
        docs: DOCS.config,
        entities: ent,
      });
    }

    const observed = Math.min(WINDOW_MS, now - p.firstAt);
    if (size > 1 && observed >= UNDERUSED_MIN_OBSERVED_MS && !(waitP95 > SATURATION_WAIT_MS) && p.backlog === 0) {
      const busy = runs.reduce((a, r) => a + r.runMs, 0);
      const util = busy / (observed * size);
      if (util < UNDERUSED_UTILIZATION) {
        add({
          id: `pool-underused:${p.key}`,
          rule: 'pool-underused',
          severity: 'info',
          title: `Pool ${poolLabel(p)} is mostly idle`,
          detail:
            `${size} workers were ${(util * 100).toFixed(1)}% busy over the last ${Math.round(observed / 1000)}s ` +
            `(${plural(runs.length, 'task')}, ${ms(busy)} total run time; threshold ${pct(UNDERUSED_UTILIZATION)}).`,
          fix:
            `\`connectWorker({ workers: 1 })\` builds a dedicated worker: no pool, no queue, one thread's memory instead of ${size}. ` +
            'Keep the pool only if independent heavy calls must overlap during bursts.',
          docs: DOCS.howMany,
          entities: ent,
        });
      }
    }
  }

  /* task-errors / task-timeouts / queue-full (per pool) */
  const queueFull = new Map(); // poolKey → { n, tasks: Set }
  for (const t of snap.tasks ?? []) {
    const settles = within(t.settles ?? [], now, WINDOW_MS);
    const p = pools.get(`${t.sid}|${t.poolId}`);
    const ent = [poolEntity(t.sid, t.poolId, p?.label)];
    const qf = settles.filter((x) => x.outcome === 'queue-full').length;
    if (qf) {
      const pk = `${t.sid}|${t.poolId}`;
      const q = queueFull.get(pk) ?? { sid: t.sid, poolId: t.poolId, n: 0, tasks: new Set() };
      q.n += qf; q.tasks.add(t.taskId);
      queueFull.set(pk, q);
    }
    if (settles.length < MIN_SETTLES) continue;
    const failed = settles.filter((x) => x.outcome === 'error' || x.outcome === 'crashed');
    const errRate = failed.length / settles.length;
    if (errRate >= ERROR_RATE_WARN) {
      const last = [...failed].reverse().find((x) => x.error)?.error;
      const crashed = failed.filter((x) => x.outcome === 'crashed').length;
      add({
        id: `task-errors:${t.key}`,
        rule: 'task-errors',
        severity: errRate >= ERROR_RATE_ERROR ? 'error' : 'warn',
        title: `Task "${t.taskId}" fails ${pct(errRate)} of calls`,
        detail:
          `${failed.length} of ${settles.length} settled calls in the last ${WINDOW_MS / 1000}s ended in error` +
          `${crashed ? ` (${crashed} crashed)` : ''} on ${poolLabel(p ?? { poolId: t.poolId })}` +
          `${last ? `. Last error: "${last.slice(0, 160)}"` : '.'}`,
        fix:
          `Drill into "${t.taskId}" in Tasks for the failing calls. \`argsSchema\`/\`resultSchema\` validation rejects at the worker boundary; ` +
          '`crashed` means the worker died mid-call (`WorkerCrashedError`), see the worker inspector.',
        docs: DOCS.tasks,
        entities: ent,
      });
    }
    const timeouts = settles.filter((x) => x.outcome === 'timeout').length;
    const toRate = timeouts / settles.length;
    if (timeouts && toRate >= TIMEOUT_RATE_WARN) {
      add({
        id: `task-timeouts:${t.key}`,
        rule: 'task-timeouts',
        severity: 'warn',
        title: `Task "${t.taskId}" times out on ${pct(toRate)} of calls`,
        detail: `${timeouts} of ${settles.length} settled calls in the last ${WINDOW_MS / 1000}s hit TaskTimeoutError on ${poolLabel(p ?? { poolId: t.poolId })}.`,
        fix:
          'The timeout counts from enqueue (queue wait + run). If waits dominate, add workers (`connectWorker({ workers })`); ' +
          'otherwise raise the budget per call with `client.with({ timeout })` or the `taskTimeout` default.',
        docs: DOCS.config,
        entities: ent,
      });
    }
  }
  for (const [pk, q] of queueFull) {
    const p = pools.get(pk);
    add({
      id: `queue-full:${pk}`,
      rule: 'queue-full',
      severity: 'warn',
      title: `Pool ${poolLabel(p ?? { poolId: q.poolId })} rejected ${plural(q.n, 'call')}: queue full`,
      detail: `${q.n} PoolQueueFullError rejections in the last ${WINDOW_MS / 1000}s (tasks: ${[...q.tasks].slice(0, 5).join(', ')}).`,
      fix:
        '`maxQueue` is the backpressure point: callers get `PoolQueueFullError` once it fills. Raise `maxQueue`, add workers ' +
        '(`connectWorker({ workers })`), or shed load upstream.',
      docs: DOCS.config,
      entities: [poolEntity(q.sid, q.poolId, p?.label)],
    });
  }

  /* worker rules: crash-loop, heap-pressure */
  for (const w of snap.workers ?? []) {
    const label = `${w.poolId}#${w.slot}`;
    const ent = [{ kind: 'worker', key: w.key, label }];
    const respawns = (w.respawns ?? []).filter((t) => now - t <= CRASH_LOOP_WINDOW_MS);
    if (respawns.length >= CRASH_LOOP_RESPAWNS) {
      add({
        id: `crash-loop:${w.key}`,
        rule: 'crash-loop',
        severity: 'error',
        title: `Worker ${label} is crash-looping`,
        detail:
          `${respawns.length} respawns in the last ${CRASH_LOOP_WINDOW_MS / 1000}s` +
          `${w.lastError ? `. Last error: "${w.lastError.slice(0, 160)}"` : '.'}`,
        fix:
          'Each crash rejects in-flight calls with `WorkerCrashedError` and spawns a replacement (`respawn` defaults to true). ' +
          'Open the worker inspector for the error; `connectWorker({ respawn: false })` stops the loop while debugging.',
        docs: DOCS.config,
        entities: ent,
      });
    }
    if (w.heap !== undefined && w.heapLimit) {
      const f = w.heap / w.heapLimit;
      if (f >= HEAP_WARN) {
        add({
          id: `heap-pressure:${w.key}`,
          rule: 'heap-pressure',
          severity: f >= HEAP_ERROR ? 'error' : 'warn',
          title: `Worker ${label} heap at ${pct(f)}`,
          detail: `${fmtBytes(w.heap)} used of a ${fmtBytes(w.heapLimit)} limit (warn ${pct(HEAP_WARN)}, error ${pct(HEAP_ERROR)}).`,
          fix:
            'Bound worker-side caches, and move large datasets held as JS objects into a `defineSharedMemory` contract ' +
            '(fixed-width, allocated once and shared instead of copied per worker).',
          docs: DOCS.sharedMemory,
          entities: ent,
        });
      }
    }
  }
  for (const s of sessions.values()) {
    if (s.heap === undefined || !s.heapLimit) continue;
    const f = s.heap / s.heapLimit;
    if (f < HEAP_WARN) continue;
    add({
      id: `heap-pressure:${s.id}`,
      rule: 'heap-pressure',
      severity: f >= HEAP_ERROR ? 'error' : 'warn',
      title: `${sessLabel(s)} main-thread heap at ${pct(f)}`,
      detail: `${fmtBytes(s.heap)} used of a ${fmtBytes(s.heapLimit)} limit (warn ${pct(HEAP_WARN)}, error ${pct(HEAP_ERROR)}).`,
      fix:
        'Check the Memory view for the largest contexts; keep big datasets in a worker or a `defineSharedMemory` contract ' +
        'rather than as main-thread objects, and bound caches.',
      docs: DOCS.sharedMemory,
      entities: [sessionEntity(s)],
    });
  }

  /* main-jank / low-fps */
  for (const s of sessions.values()) {
    const all = within(s.longframes ?? [], now, WINDOW_MS);
    const lf = all.filter((f) => !f.hidden);
    const bg = all.filter((f) => f.hidden);
    const bgScript = bg.reduce((a, f) => a + (f.scripts ? f.scripts.reduce((n, sc) => n + sc.ms, 0) : f.ms), 0);
    if (bgScript >= BG_WORK_MS) {
      add({
        id: `background-work:${s.id}`,
        rule: 'background-work',
        severity: 'info',
        title: `${ms(bgScript)} of main-thread script while the page was hidden`,
        detail:
          `${plural(bg.length, 'long frame')} in the last ${WINDOW_MS / 1000}s ran while ${sessLabel(s)} was in the background ` +
          `(threshold ${BG_WORK_MS}ms of script). Hidden tabs throttle rendering, not work: this costs battery and delays worker replies.`,
        fix:
          'Pause timers and polling on `visibilitychange` when `document.hidden`, or move the periodic work into a worker task (`connectWorker`).',
        docs: DOCS.tasks,
        entities: [sessionEntity(s)],
      });
    }
    const tbt = lf.reduce((a, f) => a + (f.blockingMs ?? 0), 0);
    if (lf.length && tbt >= TBT_WARN_MS) {
      const scripts = new Map();
      for (const f of lf) for (const sc of f.scripts ?? []) {
        const k = [sc.fn, sc.src].filter(Boolean).join(' @ ') || '(anonymous)';
        scripts.set(k, (scripts.get(k) ?? 0) + sc.ms);
      }
      const top = [...scripts.entries()].sort((a, b) => b[1] - a[1])[0];
      add({
        id: `main-jank:${s.id}`,
        rule: 'main-jank',
        severity: tbt >= TBT_ERROR_MS ? 'error' : 'warn',
        title: `Main thread blocked ${ms(tbt)} in the last ${WINDOW_MS / 1000}s`,
        detail:
          `${plural(lf.length, 'long frame')}, longest ${ms(Math.max(...lf.map((f) => f.ms)))}, total blocking time ${ms(tbt)} ` +
          `(warn ≥${TBT_WARN_MS}ms, error ≥${TBT_ERROR_MS}ms) in ${sessLabel(s)}` +
          `${top ? `. Top script: ${top[0]} (${ms(top[1])})` : '.'}`,
        fix:
          'Move synchronous work off the main thread: a `defineWorker` method called through `connectWorker`, or render the ' +
          'heavy subtree as a worker island (`mountIsland`).',
        docs: DOCS.tasks,
        entities: [sessionEntity(s)],
      });
    }
    const fr = within(s.frames ?? [], now, FPS_WINDOW_MS);
    if (fr.length >= MIN_FPS_SAMPLES) {
      const fps = avg(fr.map((f) => f.fps));
      if (fps < LOW_FPS) {
        const dropped = fr.reduce((a, f) => a + (f.dropped ?? 0), 0);
        add({
          id: `low-fps:${s.id}`,
          rule: 'low-fps',
          severity: 'warn',
          title: `Low frame rate: ${Math.round(fps)} fps`,
          detail: `${sessLabel(s)} averaged ${fps.toFixed(1)} fps with ${plural(dropped, 'dropped frame')} over the last ${fr.length}s (threshold ${LOW_FPS} fps).`,
          fix:
            'Find the blocking work in Performance (long frames); move it into a worker task (`connectWorker`) or a worker island ' +
            '(`mountIsland`) so the main thread only replays results.',
          docs: DOCS.tasks,
          entities: [sessionEntity(s)],
        });
      }
    }
  }

  /* memory-write-storm */
  for (const m of snap.memFields ?? []) {
    // Only complete seconds inside the window: the current second is partial.
    const cur = Math.floor(now / 1000) * 1000;
    const secs = (m.perSec ?? []).filter((x) => x.t < cur && cur - x.t <= WRITE_STORM_WINDOW_MS);
    if (!secs.length) continue;
    const total = secs.reduce((a, x) => a + x.v, 0);
    const rate = total / (WRITE_STORM_WINDOW_MS / 1000);
    if (rate < WRITE_STORM_PER_SEC) continue;
    add({
      id: `memory-write-storm:${m.key}`,
      rule: 'memory-write-storm',
      severity: 'warn',
      title: `Shared-memory write storm on ${m.path}`,
      detail:
        `${Math.round(rate)} writes/s on average over the last ${WRITE_STORM_WINDOW_MS / 1000}s ` +
        `(peak ${Math.max(...secs.map((x) => x.v))}/s; threshold ${WRITE_STORM_PER_SEC}/s). ` +
        "Each write bumps the field's version counter, which observers react to.",
      fix:
        'Coalesce writes: update once per frame or per batch instead of per item. For `field.list`, `writeAt(i, record)` ' +
        'is pure memory access: write the whole batch, then call `commit()` once.',
      docs: DOCS.connectors,
      entities: [{ kind: 'session', key: m.sid, label: sessLabel(sessions.get(m.sid) ?? { id: m.sid }) }],
    });
  }

  /* fetch-failing / fetch-slow (grouped by method + path) */
  const groups = new Map();
  for (const f of within(snap.fetches ?? [], now, WINDOW_MS)) {
    const k = `${f.sid}|${f.method} ${String(f.url).split('?')[0]}`;
    const g = groups.get(k) ?? { sid: f.sid, label: `${f.method} ${String(f.url).split('?')[0]}`, list: [] };
    g.list.push(f);
    groups.set(k, g);
  }
  for (const [k, g] of groups) {
    const s = sessions.get(g.sid) ?? { id: g.sid };
    const failed = g.list.filter((f) => f.error || (f.status !== undefined && f.status >= 400));
    if (failed.length) {
      const statuses = [...new Set(failed.filter((f) => f.status !== undefined).map((f) => f.status))];
      const err = failed.find((f) => f.error)?.error;
      add({
        id: `fetch-failing:${k}`,
        rule: 'fetch-failing',
        severity: 'info',
        title: `Failing requests: ${g.label}`,
        detail:
          `${failed.length} of ${g.list.length} failed in the last ${WINDOW_MS / 1000}s` +
          `${statuses.length ? ` (status ${statuses.join(', ')})` : ''}${err ? `; network error "${err.slice(0, 120)}"` : ''}.`,
        fix: 'Open the request in Network for headers and body previews; fetches issued inside workers are attributed to their pool slot.',
        entities: [sessionEntity(s)],
      });
    }
    const times = g.list.filter((f) => !f.error).map((f) => f.ms);
    if (times.length >= MIN_FETCHES) {
      const p95 = percentile(times, 95);
      if (p95 > FETCH_SLOW_MS) {
        add({
          id: `fetch-slow:${k}`,
          rule: 'fetch-slow',
          severity: 'info',
          title: `Slow requests: ${g.label}`,
          detail: `p95 ${ms(p95)} to response headers over ${plural(times.length, 'request')} (threshold ${FETCH_SLOW_MS}ms).`,
          fix:
            'Check the timing breakdown in Network (queue, dns, tcp, tls, wait, download); cross-origin stages need a ' +
            '`Timing-Allow-Origin` response header.',
          entities: [sessionEntity(s)],
        });
      }
    }
  }

  /* island-untagged (one finding per session) */
  for (const s of sessions.values()) {
    const untagged = (snap.islands ?? []).filter((i) => i.sid === s.id && i.mounted && !i.ended && !i.framework);
    if (!untagged.length) continue;
    add({
      id: `island-untagged:${s.id}`,
      rule: 'island-untagged',
      severity: 'info',
      title: `${plural(untagged.length, 'island')} without a framework tag`,
      detail:
        `${untagged.slice(0, 6).map((i) => i.instance).join(', ')}${untagged.length > 6 ? ', …' : ''} mounted with no framework tag ` +
        'and the worker reported none: expected for imperative (proxy-document) apps; the app map draws them as plain workers.',
      fix:
        "Pass the tag on the mount (`mountIsland({ framework: 'react', … })`, observability only), or register the component " +
        'through its package adapter (`reactIslandApp`, `vueIslandApp`, …), which reports its renderer.',
      docs: DOCS.islandOptions,
      entities: untagged.slice(0, 8).map((i) => ({ kind: 'island', key: i.key, label: i.instance })),
    });
  }

  const ruleIdx = new Map(RULES.map((r, i) => [r.id, i]));
  return out.sort(
    (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (ruleIdx.get(a.rule) ?? 99) - (ruleIdx.get(b.rule) ?? 99),
  );
}

/**
 * Which rules currently have the input data they need (the UI marks the
 * rest as "waiting for data"). Pure, same snapshot as runAudits.
 * @param {AuditSnapshot} snap
 * @returns {Record<string, boolean>}
 */
export function ruleCoverage(snap) {
  const tasks = snap.tasks ?? [];
  const islands = snap.islands ?? [];
  const pools = snap.pools ?? [];
  const sessions = snap.sessions ?? [];
  const anyBatch = (k) => islands.some((i) => (i.batches ?? []).some((b) => b[k] !== undefined));
  const anySettle = tasks.some((t) => (t.settles ?? []).length);
  return {
    'coi-islands': sessions.some((s) => s.env?.crossOriginIsolated !== undefined) && islands.length > 0,
    'large-args': tasks.some((t) => (t.argBytes ?? []).length),
    'large-results': tasks.some((t) => (t.resultBytes ?? []).length),
    'island-batch-bytes': anyBatch('bytes'),
    'island-slow-replay': anyBatch('replayMs'),
    'pool-saturated': pools.some((p) => !p.dedicated && (p.dispatches ?? []).length),
    'pool-underused': pools.some((p) => !p.dedicated && (p.poolSize ?? 0) > 1),
    'pool-oversized': pools.some((p) => p.initSeen) && sessions.some((s) => s.env?.hardwareConcurrency),
    'main-jank': sessions.some((s) => (s.longframes ?? []).some((f) => !f.hidden)),
    'background-work': sessions.some((s) => (s.longframes ?? []).some((f) => f.hidden)),
    'low-fps': sessions.some((s) => (s.frames ?? []).length),
    'task-errors': anySettle,
    'task-timeouts': anySettle,
    'queue-full': anySettle,
    'crash-loop': (snap.workers ?? []).length > 0,
    'heap-pressure': (snap.workers ?? []).some((w) => w.heapLimit) || sessions.some((s) => s.heapLimit),
    'devtools-late': pools.length > 0,
    'memory-write-storm': (snap.memFields ?? []).length > 0,
    'fetch-failing': (snap.fetches ?? []).length > 0,
    'fetch-slow': (snap.fetches ?? []).length > 0,
    'island-untagged': islands.length > 0,
  };
}
