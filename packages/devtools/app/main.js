// atoll devtools — analytics dashboard over the /view WebSocket.
// State is rebuilt incrementally from the event stream; nothing here knows
// about the app except the event shapes from @atolljs/core's devtools union.
//
// Time basis: each event's `at` is performance.now() on its emitting
// thread, so intra-session timelines (the waterfall) use `at` directly.
// Cross-session ordering is only meaningful within one session.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n, d = 1) => (n === undefined || n === null ? '—' : Number(n).toFixed(d));
const fmtBytes = (b) => (b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)}MB` : b >= 1024 ? `${(b / 1024).toFixed(1)}KB` : `${b}B`);
const fmtInt = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
const key = (sess, ...rest) => [sess, ...rest].join('|');
const sessOf = (k) => k.split('|')[0];
/** Session heap in bytes — plain sample, else sum of measured contexts. */
const sessHeapOf = (sid) => {
  const h = state.sessHeap.get(sid);
  if (h) return h.heap;
  const ctx = state.sessCtx.get(sid);
  if (!ctx?.length) return undefined;
  return ctx.reduce((a, c) => a + c.bytes, 0);
};

const OUTCOME_COLOR = {
  ok: '#58a6ff', error: '#f85149', crashed: '#f85149',
  aborted: '#d29922', timeout: '#d29922', 'queue-full': '#d29922',
};

const state = {
  sessions: new Map(),      // id → SessionInfo
  sel: null,                // session id or null = all
  drillTask: null,          // taskId drilldown filter or null
  inspect: null,            // `${sess}|${instance}` under inspection or null
  inspectWorker: null,      // `${sess}|${poolId}|${slot}` under inspection or null
  inspectFetch: null,       // fetches[].seq under inspection or null
  workers: new Map(),       // `${sess}|${poolId}|${slot}` → worker record
  series: new Map(),        // `${sess}|${metric}|${sec}` → number — per-second rollup for live charts
  pools: new Map(),         // `${sess}|${poolId}` → pool record
  calls: new Map(),         // `${sess}|${poolId}|${callId}` → call record
  callOrder: [],            // insertion order of call keys
  mem: new Map(),           // `${sess}|${path}` → { writes, version, thread, buckets: Map }
  islands: new Map(),       // `${sess}|${instance}` → island record
  tput: new Map(),          // `${sess}|${sec}` → { n, err } — settle events per second
  fetches: [],              // [{seq,id,src,at,sess,worker,url,method,status,ms,bytes,error,reqHeaders,reqBody,d?}] capped 300
  sessHeap: new Map(),      // sid → {heap, limit} — latest runtime:memory sample
  sessCtx: new Map(),       // sid → [{bytes,scope,url}] — measureUserAgentSpecificMemory contexts
  heapSeries: new Map(),    // sid → Map(dashSec → MB) — heap over time, keyed by dashboard receive clock
  alerts: [],               // [{at, sess, kind, text}]
  seq: 0,
  t0: null,                 // earliest event.at seen (per selected set — min)
};

const MAX_CALLS = 2000;
const MAX_ALERTS = 60;

/* ── event reducer ───────────────────────────────────────────────────────── */

const bump = (sid, metric, at, n = 1) => {
  const k = `${sid}|${metric}|${Math.floor(at / 1000)}`;
  state.series.set(k, (state.series.get(k) ?? 0) + n);
};

function applyEvent(sess, e) {
  const sid = sess.id;
  if (state.t0 === null || e.at < state.t0) state.t0 = e.at;
  switch (e.type) {
    case 'pool:init':
      state.pools.set(key(sid, e.poolId), {
        poolId: e.poolId, label: e.label ?? e.poolId, size: e.poolSize,
        memoryBytes: e.memoryBytes, workers: new Set(), tasks: 0, failed: 0,
        dead: sess.closed === true,
      });
      break;
    case 'pool:terminate': {
      const p = state.pools.get(key(sid, e.poolId));
      if (p) p.dead = true;
      for (const [k, w] of state.workers) {
        if (k.startsWith(`${sid}|${e.poolId}|`)) w.dead = true;
      }
      break;
    }
    case 'worker:spawn': {
      state.pools.get(key(sid, e.poolId))?.workers.add(e.slot);
      const w = getWorker(sid, e.poolId, e.slot, e.at);
      w.spawnedAt = e.at;
      if (!sess.closed) w.dead = false;
      break;
    }
    case 'worker:respawn': {
      state.pools.get(key(sid, e.poolId))?.workers.add(e.slot);
      const w = getWorker(sid, e.poolId, e.slot, e.at);
      w.respawns++; w.spawnedAt = e.at;
      if (!sess.closed) w.dead = false;
      alert(sess, e, 'worker respawned', `pool ${e.poolId} slot ${e.slot}`);
      break;
    }
    case 'worker:error': {
      const w = getWorker(sid, e.poolId, e.slot, e.at);
      w.errors.push({ at: e.at, message: e.message });
      if (w.errors.length > 50) w.errors.shift();
      w.dead = true;
      alert(sess, e, 'worker error', `${e.poolId} slot ${e.slot}: ${e.message}`);
      break;
    }
    case 'task:enqueue': {
      bump(sid, 'enq', e.at);
      const k = key(sid, e.poolId, e.callId);
      state.calls.set(k, { taskId: e.taskId, poolId: e.poolId, sess: sid, enqAt: e.at, seq: ++state.seq });
      state.callOrder.push(k);
      if (state.callOrder.length > MAX_CALLS * 2) {
        const drop = state.callOrder.splice(0, state.callOrder.length - MAX_CALLS);
        for (const k of drop) state.calls.delete(k);
      }
      const p = state.pools.get(key(sid, e.poolId));
      if (p) p.tasks++;
      break;
    }
    case 'task:dispatch': {
      bump(sid, 'disp', e.at);
      const c = state.calls.get(key(sid, e.poolId, e.callId));
      if (c) { c.waitMs = e.waitMs; c.dispAt = e.at; c.slot = e.slot; }
      const w = getWorker(sid, e.poolId, e.slot, e.at);
      w.tasks++; w.lastAt = e.at; w.lastTaskId = e.taskId;
      break;
    }
    case 'task:settle': {
      bump(sid, 'settle', e.at);
      if (e.outcome !== 'ok') bump(sid, 'err', e.at);
      if (e.runMs !== undefined) { bump(sid, 'runSum', e.at, e.runMs); bump(sid, 'runN', e.at); }
      const c = state.calls.get(key(sid, e.poolId, e.callId));
      if (c) { c.outcome = e.outcome; c.runMs = e.runMs; c.error = e.error; c.settleAt = e.at; }
      if (c?.slot !== undefined) {
        const w = getWorker(sid, e.poolId, c.slot, e.at);
        w.lastAt = e.at; w.lastTaskId = e.taskId;
        if (e.outcome !== 'ok') {
          w.failed++;
          if (e.error) {
            w.errors.push({ at: e.at, message: `${e.taskId}: ${e.error}` });
            if (w.errors.length > 50) w.errors.shift();
          }
        }
      }
      const sec = Math.floor(e.at / 1000);
      const bk = key(sid, sec);
      const b = state.tput.get(bk) ?? { n: 0, err: 0 };
      b.n++; if (e.outcome !== 'ok') b.err++;
      state.tput.set(bk, b);
      if (e.outcome !== 'ok') {
        const p = state.pools.get(key(sid, e.poolId));
        if (p) p.failed++;
        alert(sess, e, e.outcome, `${e.taskId} — ${e.outcome}${e.error ? `: ${e.error}` : ''}`);
      }
      break;
    }
    case 'memory:write': {
      bump(sid, 'wr', e.at);
      const k = key(sid, e.path);
      const m = state.mem.get(k) ?? { writes: 0, buckets: new Map() };
      m.writes++; m.version = e.version; m.thread = e.thread; m.lastAt = e.at;
      // worker:* forwarded events carry slot attribution — pin the writer.
      if (e.worker) m.writer = `${e.worker.poolId}#${e.worker.slot}`;
      const sec = Math.floor(e.at / 1000);
      m.buckets.set(sec, (m.buckets.get(sec) ?? 0) + 1);
      if (m.buckets.size > 120) m.buckets.delete([...m.buckets.keys()][0]);
      state.mem.set(k, m);
      break;
    }
    case 'island:mount': {
      // island:task/island:ops for the mount round-trip arrive BEFORE this
      // event — merge into the record rather than overwriting it.
      const i = getIsland(sid, e.instance, e.at);
      i.app = e.app; i.pid = e.pid; i.mountedAt = e.at; i.fw = e.framework;
      if (!sess.closed) i.ended = false;
      if (e.poolId) i.poolId = e.poolId;
      break;
    }
    case 'island:ops': {
      bump(sid, 'iops', e.at, e.count);
      const i = getIsland(sid, e.instance, e.at);
      i.batches++; i.ops += e.count; i.replayMs += e.replayMs ?? 0;
      i.timeline.push({ at: e.at, via: e.via, count: e.count, replayMs: e.replayMs ?? 0 });
      if (i.timeline.length > 400) i.timeline.shift();
      const v = i.byVia.get(e.via) ?? { batches: 0, ops: 0, replayMs: 0 };
      v.batches++; v.ops += e.count; v.replayMs += e.replayMs ?? 0;
      i.byVia.set(e.via, v);
      break;
    }
    case 'island:task': {
      bump(sid, 'irt', e.at);
      const i = getIsland(sid, e.instance, e.at);
      i.tasks.push({ at: e.at, method: e.method, ms: e.ms, ops: e.ops, error: e.error, seq: ++state.seq });
      if (i.tasks.length > 500) i.tasks.shift();
      break;
    }
    case 'island:event': {
      bump(sid, 'iev', e.at);
      const i = getIsland(sid, e.instance, e.at);
      i.events++;
      i.eventNames.set(e.name, (i.eventNames.get(e.name) ?? 0) + 1);
      break;
    }
    case 'island:unmount': {
      const i = state.islands.get(key(sid, e.instance));
      if (i) i.ended = true;
      break;
    }
    case 'net:fetch': {
      bump(sid, 'fetch', e.at);
      state.fetches.push({
        seq: ++state.seq, at: e.at, sess: sid, worker: e.worker,
        id: e.id, src: `${e.thread}:${e.worker ? `${e.worker.poolId}#${e.worker.slot}` : 'main'}`,
        url: e.url, method: e.method, status: e.status, ms: e.ms, bytes: e.bytes, error: e.error,
        reqHeaders: e.reqHeaders, reqBody: e.reqBody,
      });
      if (state.fetches.length > 300) state.fetches.splice(0, state.fetches.length - 300);
      break;
    }
    case 'net:fetch-detail': {
      // Merge into the matching base record (same context id + source).
      const src = `${e.thread}:${e.worker ? `${e.worker.poolId}#${e.worker.slot}` : 'main'}`;
      const f = [...state.fetches].reverse().find((x) => x.sess === sid && x.id === e.id && x.src === src);
      if (f) {
        f.d = {
          resHeaders: e.resHeaders, resBody: e.resBody, timing: e.timing,
          transferSize: e.transferSize, encodedSize: e.encodedSize, decodedSize: e.decodedSize,
        };
        if (e.reqBody !== undefined) f.reqBody = e.reqBody;
      }
      break;
    }
    case 'runtime:memory': {
      if (e.worker) {
        // Worker-reported heap — its own context (measureMemory own-URL
        // filter, or worker-side performance.memory) stamped to the slot.
        const w = getWorker(sid, e.worker.poolId, e.worker.slot, e.at);
        w.heap = e.heapBytes; w.heapLimit = e.heapLimitBytes; w.lastAt = e.at;
        const sec = Math.floor(e.at / 1000);
        (w.heapSeries ??= new Map()).set(sec, e.heapBytes / 1048576); // MB for the chart
        if (w.heapSeries.size > 120) w.heapSeries.delete([...w.heapSeries.keys()][0]);
      }
      if (!e.worker) {
        state.sessHeap.set(sid, { heap: e.heapBytes, limit: e.heapLimitBytes });
        if (e.contexts) state.sessCtx.set(sid, e.contexts);
        // Series on the dashboard clock — emit threads have unrelated epochs.
        const hs = state.heapSeries.get(sid) ?? new Map();
        hs.set(Math.floor(performance.now() / 1000), e.heapBytes / 1048576);
        if (hs.size > 240) hs.delete([...hs.keys()][0]); // ~10min at 2.5s sampling
        state.heapSeries.set(sid, hs);
      }
      break;
    }
  }
}

function getWorker(sid, poolId, slot, at) {
  const k = key(sid, poolId, slot);
  let w = state.workers.get(k);
  if (!w) {
    w = { spawnedAt: at, respawns: 0, errors: [], tasks: 0, failed: 0, lastAt: at, lastTaskId: '', dead: state.sessions.get(sid)?.closed === true };
    state.workers.set(k, w);
  }
  return w;
}

function getIsland(sid, instance, at) {
  const k = key(sid, instance);
  let i = state.islands.get(k);
  if (!i) {
    i = {
      app: instance.split('@')[0], pid: '—', batches: 0, ops: 0, replayMs: 0, events: 0,
      tasks: [], timeline: [], eventNames: new Map(), byVia: new Map(),
      mountedAt: at, ended: state.sessions.get(sid)?.closed === true, seq: ++state.seq,
    };
    state.islands.set(k, i);
  }
  return i;
}

function alert(sess, e, kind, text) {
  state.alerts.unshift({ at: e.at, sessId: sess.id, sess: sess.name ?? sess.id, kind, text });
  if (state.alerts.length > MAX_ALERTS) state.alerts.pop();
}

/** Drop state for fully-evicted sessions; mark closed sessions' entities dead. */
function reconcileSessions(live) {
  state.sessions = new Map(live.map((s) => [s.id, s]));
  const ids = new Set(live.map((s) => s.id));
  const closedIds = new Set(live.filter((s) => s.closed).map((s) => s.id));
  for (const [k, p] of state.pools) if (closedIds.has(sessOf(k))) p.dead = true;
  for (const [k, w] of state.workers) if (closedIds.has(sessOf(k))) w.dead = true;
  for (const [k, i] of state.islands) if (closedIds.has(sessOf(k))) i.ended = true;
  for (const map of [state.pools, state.mem, state.islands, state.workers, state.series]) {
    for (const k of [...map.keys()]) if (!ids.has(sessOf(k))) map.delete(k);
  }
  for (const k of [...state.calls.keys()]) {
    if (!ids.has(sessOf(k))) { state.calls.delete(k); }
  }
  state.callOrder = state.callOrder.filter((k) => state.calls.has(k));
  for (const k of [...state.tput.keys()]) if (!ids.has(sessOf(k))) state.tput.delete(k);
  state.fetches = state.fetches.filter((f) => ids.has(f.sess));
  for (const sid of [...state.sessHeap.keys()]) if (!ids.has(sid)) state.sessHeap.delete(sid);
  for (const sid of [...state.sessCtx.keys()]) if (!ids.has(sid)) state.sessCtx.delete(sid);
  for (const sid of [...state.heapSeries.keys()]) if (!ids.has(sid)) state.heapSeries.delete(sid);
  state.alerts = state.alerts.filter((a) => !a.sessId || ids.has(a.sessId));
  if (state.sel && !ids.has(state.sel)) state.sel = null;
  if (state.inspect && !state.islands.has(state.inspect)) state.inspect = null;
  if (state.inspectWorker && !state.workers.has(state.inspectWorker)) state.inspectWorker = null;
}

/**
 * Selected-session mode shows that session (live or ended — post-mortem).
 * "All sessions" mode merges LIVE sessions only; ended sessions stay out
 * of KPIs, charts, and tables until explicitly selected.
 */
const inSel = (k) =>
  state.sel !== null
    ? sessOf(k) === state.sel
    : state.sessions.get(sessOf(k))?.closed !== true;

/**
 * "All sessions" rendering: sort items into session order (live first —
 * the server lists live sessions before closed ones) and emit a group
 * header row at each boundary. Selected-session mode stays flat.
 * `rowFn` returns the row's <tr> html for one item.
 */
const withGroups = (items, getSess, cols, rowFn) => {
  if (state.sel !== null) return items.map(rowFn).join('') || null;
  const order = [...state.sessions.keys()];
  const sorted = [...items].sort(
    (a, b) => order.indexOf(getSess(a)) - order.indexOf(getSess(b)),
  );
  let html = '', last = null;
  for (const it of sorted) {
    const s = getSess(it);
    if (s !== last) {
      last = s;
      const sess = state.sessions.get(s);
      html += `<tr class="grp"><td colspan="${cols}">⦿ ${esc(sess?.name ?? s)}${sess?.closed ? ' (ended)' : ''}</td></tr>`;
    }
    html += rowFn(it);
  }
  return html || null;
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

const sortedRuns = (runs) => [...runs].sort((a, b) => a - b);
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : undefined;

function sparkline(canvas, values, color = '#58a6ff') {
  const ctx = canvas.getContext('2d');
  const w = (canvas.width = canvas.clientWidth || 120);
  const h = (canvas.height = canvas.clientHeight || 28);
  ctx.clearRect(0, 0, w, h);
  if (!values.length) return;
  const max = Math.max(...values, 1);
  const bw = w / values.length;
  ctx.fillStyle = color;
  values.forEach((v, i) => {
    const bh = Math.max(1, (v / max) * (h - 2));
    ctx.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh);
  });
}

/* ── live charts (Network + Memory tabs) ─────────────────────────────────── */

const CHART_SECS = 60;

/** sec→value points for one metric, summed across the selected sessions. */
function seriesFor(metric) {
  const pts = new Map();
  for (const [k, v] of state.series) {
    const [sid, m, sec] = k.split('|');
    if (m !== metric || !inSel(k)) continue;
    const s = Number(sec);
    pts.set(s, (pts.get(s) ?? 0) + v);
  }
  return [...pts.entries()].map(([sec, v]) => ({ sec, v })).sort((a, b) => a.sec - b.sec);
}

/** Merge two per-second maps into avg points (sum ÷ count), e.g. run ms. */
function avgSeries(sumPts, nPts) {
  const n = new Map(nPts.map((p) => [p.sec, p.v]));
  return sumPts.filter((p) => n.get(p.sec)).map((p) => ({ sec: p.sec, v: p.v / n.get(p.sec) }));
}

/** Cumulative (a-b) line — used for in-flight calls = dispatched − settled. */
function deltaSeries(aPts, bPts) {
  const b = new Map(bPts.map((p) => [p.sec, p.v]));
  const secs = new Set([...aPts.map((p) => p.sec), ...b.keys()]);
  const a = new Map(aPts.map((p) => [p.sec, p.v]));
  let acc = 0;
  return [...secs].sort((x, y) => x - y).map((sec) => {
    acc += (a.get(sec) ?? 0) - (b.get(sec) ?? 0);
    return { sec, v: Math.max(0, acc) };
  });
}

const fmtChart = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v % 1 ? v.toFixed(1) : String(v));

/** Scale + axis annotations shared by both chart renderers. */
function annotate(ctx, W, H, max, lastX, lastY, color) {
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillStyle = '#8b949e';
  ctx.textBaseline = 'top';
  ctx.fillText(fmtChart(max), 4, 3);                    // top of scale
  ctx.fillText('0', 4, H - 12);                          // bottom of scale
  ctx.textAlign = 'right';
  ctx.fillText('now', W - 4, H - 12);
  ctx.fillText('-60s', W * 0.5 + 20, H - 12);
  ctx.textAlign = 'left';
  if (lastX !== undefined) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(lastX, lastY, 2.5, 0, 7); ctx.fill();
    ctx.strokeStyle = `${color}66`;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(lastX, 0); ctx.lineTo(lastX, H - 12); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawLine(canvas, points, color = '#58a6ff') {
  const ctx = canvas.getContext('2d');
  const W = (canvas.width = canvas.clientWidth || 270);
  const H = (canvas.height = canvas.clientHeight || 64);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#21262d';
  for (let g = 1; g <= 3; g++) {
    const gy = H - (g / 3) * (H - 12);
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }
  if (!points.length) {
    ctx.fillStyle = '#484f58'; ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('no data', 4, 4);
    return;
  }
  const hi = Math.max(...points.map((p) => p.sec));
  const lo = hi - CHART_SECS + 1;
  const vals = new Map(points.map((p) => [p.sec, p.v]));
  const max = Math.max(...points.map((p) => p.v), 0.01);
  const x = (s) => ((s - lo) / CHART_SECS) * W;
  const y = (v) => (H - 3) - (v / max) * (H - 15);
  ctx.beginPath();
  for (let s = lo; s <= hi; s++) {
    const py = y(vals.get(s) ?? 0);
    s === lo ? ctx.moveTo(x(s), py) : ctx.lineTo(x(s), py);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.lineTo(x(hi), H); ctx.lineTo(x(lo), H); ctx.closePath();
  ctx.fillStyle = `${color}22`; ctx.fill();
  ctx.lineWidth = 1;
  annotate(ctx, W, H, max, x(hi), y(vals.get(hi) ?? 0), color);
}

function drawMultiLine(canvas, lines) {
  const ctx = canvas.getContext('2d');
  const W = (canvas.width = canvas.clientWidth || 270);
  const H = (canvas.height = canvas.clientHeight || 80);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#21262d';
  for (let g = 1; g <= 3; g++) {
    const gy = H - (g / 3) * (H - 12);
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }
  const allSecs = lines.flatMap((l) => l.points.map((p) => p.sec));
  if (!allSecs.length) return;
  const hi = Math.max(...allSecs);
  const lo = hi - CHART_SECS + 1;
  const max = Math.max(...lines.flatMap((l) => l.points.map((p) => p.v)), 0.01);
  const x = (s) => ((s - lo) / CHART_SECS) * W;
  const y = (v) => (H - 3) - (v / max) * (H - 15);
  for (const { points, color } of lines) {
    const vals = new Map(points.map((p) => [p.sec, p.v]));
    ctx.beginPath();
    for (let s = lo; s <= hi; s++) {
      const py = y(vals.get(s) ?? 0);
      s === lo ? ctx.moveTo(x(s), py) : ctx.lineTo(x(s), py);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.lineWidth = 1;
  annotate(ctx, W, H, max);
}

const NET_CARDS = [
  { id: 'ch-tasks', label: 'tasks /s', color: '#58a6ff', get: () => seriesFor('settle') },
  { id: 'ch-lat', label: 'avg run ms', color: '#a371f7', get: () => avgSeries(seriesFor('runSum'), seriesFor('runN')) },
  { id: 'ch-err', label: 'errors /s', color: '#f85149', get: () => seriesFor('err') },
  { id: 'ch-inf', label: 'in-flight calls', color: '#d29922', get: () => deltaSeries(seriesFor('disp'), seriesFor('settle')) },
  { id: 'ch-iops', label: 'island ops /s', color: '#3fb950', get: () => seriesFor('iops') },
  { id: 'ch-irt', label: 'island round-trips /s', color: '#58a6ff', get: () => seriesFor('irt') },
  { id: 'ch-iev', label: 'island events /s', color: '#79c0ff', get: () => seriesFor('iev') },
  { id: 'ch-fetch', label: 'fetches /s', color: '#f0883e', get: () => seriesFor('fetch') },
];

/** Display form of a URL — path+query when same-origin, full URL otherwise. */
const shortUrl = (u) => {
  try {
    const x = new URL(u);
    return x.origin === location.origin ? x.pathname + x.search : u;
  } catch {
    return u;
  }
};

function renderNetwork() {
  const host = $('charts');
  if (!host.children.length) {
    host.innerHTML = NET_CARDS.map((c) =>
      `<div class="chart-card"><div class="lbl"><span>${c.label}</span><span><b id="${c.id}-v" style="color:${c.color}">—</b> <span class="muted" id="${c.id}-p"></span></span></div><canvas id="${c.id}"></canvas></div>`,
    ).join('');
  }
  for (const c of NET_CARDS) {
    const pts = c.get();
    drawLine($(c.id), pts, c.color);
    const last = pts.at(-1);
    const peak = pts.length ? Math.max(...pts.map((p) => p.v)) : 0;
    $(`${c.id}-v`).textContent = last ? fmtChart(last.v) : '0';
    $(`${c.id}-p`).textContent = pts.length ? `peak ${fmtChart(peak)}` : '';
  }

  const fl = state.fetches.filter((f) => inSel(f.sess)).slice(-150).reverse();
  $('fetchlog').querySelector('tbody').innerHTML = withGroups(fl, (f) => f.sess, 7, (f) => {
    const cls = f.error || f.status >= 400 ? 'error' : f.status >= 300 ? 'timeout' : 'ok';
    return `<tr data-fetch="${f.seq}">
      <td class="muted">${esc(state.sessions.get(f.sess)?.name ?? f.sess)}</td>
      <td>${fmt(f.ms)}</td>
      <td class="${cls}">${f.status !== undefined ? f.status : '✕'}</td>
      <td>${esc(f.method)}</td>
      <td class="url" title="${esc(f.url)}">${esc(shortUrl(f.url))}</td>
      <td class="muted">${f.worker ? `${esc(f.worker.poolId)}#${f.worker.slot}` : 'main'}</td>
      <td class="muted">${f.bytes !== undefined ? fmtBytes(f.bytes) : '—'}</td></tr>`;
  }) || '<tr><td colspan="7" class="muted">no fetches — enable with connectDevtools() on the app</td></tr>';
  for (const tr of $('fetchlog').querySelectorAll('tr[data-fetch]')) {
    tr.onclick = () => {
      state.inspectFetch = Number(tr.dataset.fetch);
      openSub('network', 'nv-req');
    };
  }
}

/* ── request detail (network inspector) ─────────────────────────────────── */

const TIMING_STAGES = [
  ['queue', 'stalled/queue', '#8b949e'],
  ['dns', 'dns', '#d29922'],
  ['tcp', 'tcp connect', '#58a6ff'],
  ['tls', 'tls', '#a371f7'],
  ['wait', 'request + waiting', '#f0883e'],
  ['download', 'download', '#3fb950'],
];

function renderFetchInsp() {
  const btn = $('navNetReq');
  const f = state.fetches.find((x) => x.seq === state.inspectFetch);
  if (!f) {
    btn.style.display = 'none';
    if ($('nv-req').classList.contains('on')) {
      document.querySelector('#view-network .subnav button[data-sub="nv-traffic"]').click();
    }
    return;
  }
  btn.style.display = '';
  btn.textContent = `Request: ${f.method} ${shortUrl(f.url).slice(0, 24)}`;

  const cls = f.error || f.status >= 400 ? 'error' : f.status >= 300 ? 'timeout' : 'ok';
  $('reqTitle').innerHTML =
    `Request — <b>${esc(f.method)} ${esc(f.url)}</b> · ` +
    `<span class="${cls}">${f.error ? `failed: ${esc(f.error)}` : `status ${f.status}`}</span> · ` +
    `${esc(state.sessions.get(f.sess)?.name ?? f.sess)} · from ${f.worker ? `${esc(f.worker.poolId)}#${f.worker.slot}` : 'main'}`;

  const d = f.d;
  const size = d?.transferSize ?? f.bytes;
  const kpi = (v, l) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('reqKpis').innerHTML =
    kpi(`${fmt(f.ms)}`, 'total ms (to headers)') +
    kpi(d?.timing ? fmt(d.timing.wait) : '—', 'wait (ttfb)') +
    kpi(d?.timing ? fmt(d.timing.download) : '—', 'download ms') +
    kpi(size !== undefined ? fmtBytes(size) : '—', 'transferred') +
    kpi(d?.decodedSize !== undefined ? fmtBytes(d.decodedSize) : '—', 'decoded');

  if (d?.timing) {
    const t = d.timing;
    const total = TIMING_STAGES.reduce((a, [k]) => a + (t[k] || 0), 0);
    $('reqTiming').innerHTML =
      `<div class="tbar">${TIMING_STAGES.map(([k, , c]) =>
        `<div style="flex:0 0 ${total ? (100 * (t[k] || 0)) / total : 0}%;background:${c}" title=""></div>`,
      ).join('')}</div>` +
      `<table class="tkv" style="margin-top:6px"><tbody>${TIMING_STAGES.map(([k, l, c]) =>
        `<tr><td><span style="color:${c}">■</span> ${l}</td><td>${fmt(t[k] || 0)} ms${total ? ` · ${fmt((100 * (t[k] || 0)) / total, 0)}%` : ''}</td></tr>`,
      ).join('')}<tr><td>total (resource timing)</td><td>${fmt(total)} ms</td></tr></tbody></table>`;
  } else {
    $('reqTiming').innerHTML = `<div class="muted">${d ? 'resource timing unavailable (cross-origin without Timing-Allow-Origin, or entry evicted)' : 'detail pending — waiting for response body / timing entry…'}</div>`;
  }

  const hdr = (h) =>
    h?.length ? h.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('') : '<tr><td colspan="2" class="muted">—</td></tr>';
  $('reqReqH').innerHTML = hdr(f.reqHeaders);
  $('reqResH').innerHTML = hdr(d?.resHeaders);
  $('reqReqB').textContent = f.reqBody ?? (f.method === 'GET' || f.method === 'HEAD' ? '' : '(not captured)');
  $('reqResB').textContent = d?.resBody ?? (d ? '(binary or no body)' : '');
}

/* ── overview ────────────────────────────────────────────────────────────── */

function renderOverview() {
  const pools = [...state.pools.entries()].filter(([k]) => inSel(k));
  const calls = state.callOrder.filter(inSel).map((k) => state.calls.get(k)).filter(Boolean);
  const settled = calls.filter((c) => c.outcome);
  const failed = settled.filter((c) => c.outcome !== 'ok');
  const runs = sortedRuns(settled.map((c) => c.runMs).filter((v) => v !== undefined));
  const writes = [...state.mem.entries()].filter(([k]) => inSel(k)).reduce((a, [, m]) => a + m.writes, 0);
  const islands = [...state.islands.entries()].filter(([k, i]) => inSel(k) && !i.ended).length;
  const isEnded = (k) => state.sessions.get(sessOf(k))?.closed === true;
  const livePools = pools.filter(([k, p]) => !p.dead && !isEnded(k)).length;
  const errRate = settled.length ? (100 * failed.length) / settled.length : 0;

  const kpi = (v, l, cls = '') => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('kpis').innerHTML =
    kpi(livePools, 'live pools', livePools ? 'good' : '') +
    kpi(fmtInt(settled.length), 'tasks settled') +
    kpi(`${fmt(errRate, 1)}%`, 'error rate', errRate > 5 ? 'bad' : errRate > 0 ? 'warn' : 'good') +
    kpi(fmt(pct(runs, 0.95)), 'run p95 ms') +
    kpi(fmt(Math.max(...runs, 0)), 'run max ms', runs.length && Math.max(...runs) > 10 * (pct(runs, 0.5) ?? 1) ? 'warn' : '') +
    kpi(fmtInt(writes), 'field writes') +
    kpi(islands, 'islands') +
    kpi(pools.reduce((a, [, p]) => a + p.workers.size, 0), 'workers');

  const alerts = state.sel === null
    ? state.alerts.filter((a) => !a.sessId || state.sessions.get(a.sessId)?.closed !== true)
    : state.alerts.filter((a) => a.sessId === state.sel);
  $('alerts').innerHTML = alerts.length
    ? alerts.map((a) => `<div><span class="${a.kind}">${esc(a.kind)}</span> <span class="muted">${esc(a.sess)}</span> ${esc(a.text)}</div>`).join('')
    : '<div class="muted">nothing flagged</div>';

  $('pools').querySelector('tbody').innerHTML = withGroups(pools, ([k]) => sessOf(k), 7, ([k, p]) => {
    const sess = state.sessions.get(sessOf(k));
    const ended = sess?.closed === true;
    return `<tr class="${p.dead || ended ? 'muted' : ''}">
      <td class="muted">${esc(sess?.name ?? sessOf(k))}${ended ? ' (ended)' : ''}</td>
      <td>${esc(p.label)}${p.label !== p.poolId ? ` <span class="muted">${esc(p.poolId)}</span>` : ''}${p.dead ? '<span class="pill">terminated</span>' : ''}</td>
      <td>${p.size}</td><td>${p.memoryBytes !== undefined ? fmtBytes(p.memoryBytes) : '—'}</td>
      <td>${p.workers.size}</td><td>${p.tasks}</td><td class="${p.failed ? 'error' : ''}">${p.failed}</td></tr>`;
  }) || '<tr><td colspan="7" class="muted">no pools</td></tr>';

  drawThroughput();
}

function drawThroughput() {
  const canvas = $('tput');
  const ctx = canvas.getContext('2d');
  const w = (canvas.width = canvas.clientWidth || 560);
  const h = (canvas.height = 80);
  ctx.clearRect(0, 0, w, h);
  if (state.t0 === null) return;
  const buckets = [...state.tput.entries()].filter(([k]) => inSel(k));
  const secs = buckets.map(([k]) => Number(k.split('|')[1]));
  if (!secs.length) return;
  const lo = Math.min(...secs), hi = Math.max(...secs);
  const span = Math.max(hi - lo + 1, 1);
  const bw = w / Math.max(span, 60);
  const max = Math.max(...buckets.map(([, b]) => b.n), 1);
  for (const [k, b] of buckets) {
    const sec = Number(k.split('|')[1]);
    const x = (sec - lo) * (w / Math.max(span, 60));
    const bh = (b.n / max) * (h - 4);
    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(x, h - bh, Math.max(1, bw - 1), bh);
    if (b.err) {
      const eh = (b.err / max) * (h - 4);
      ctx.fillStyle = '#f85149';
      ctx.fillRect(x, h - bh, Math.max(1, bw - 1), eh);
    }
  }
}

/* ── tasks: waterfall + aggregates + table ───────────────────────────────── */

function visibleCalls() {
  return state.callOrder.filter(inSel).map((k) => state.calls.get(k)).filter(Boolean);
}

/**
 * Waterfall/flame render: one lane per (pool, slot), gray wait segment then
 * outcome-colored run segment. Segments are stored on `canvas._segs` for
 * the shared hover/click handlers — used by both the Tasks view and the
 * worker inspector's single-lane view.
 */
function drawWaterfall(canvas, calls, emptyMsg) {
  const ctx = canvas.getContext('2d');
  const W = (canvas.width = canvas.clientWidth || 800);
  const H = (canvas.height = canvas.clientHeight || 240);
  ctx.clearRect(0, 0, W, H);
  canvas._segs = [];
  calls = calls.filter((c) => c.dispAt !== undefined);
  if (!calls.length) {
    ctx.fillStyle = '#8b949e';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(emptyMsg, 12, 20);
    return 0;
  }
  const last = calls.at(-1);
  const t1 = Math.max(...calls.map((c) => c.settleAt ?? last.enqAt + 1));
  const t0 = Math.min(...calls.map((c) => c.enqAt), t1 - 30000);
  const span = Math.max(t1 - t0, 1);

  const laneOf = (c) => `${c.poolId}#${c.slot ?? '?'}`;
  const lanes = [...new Set(calls.map(laneOf))];
  const laneH = Math.min(28, (H - 16) / lanes.length);
  const x = (t) => 8 + ((t - t0) / span) * (W - 16);
  const y = (lane) => 8 + lanes.indexOf(lane) * laneH;

  ctx.font = '10px ui-monospace, monospace';
  lanes.forEach((l) => {
    const yy = y(l);
    ctx.strokeStyle = '#21262d';
    ctx.beginPath(); ctx.moveTo(0, yy + laneH); ctx.lineTo(W, yy + laneH); ctx.stroke();
    ctx.fillStyle = '#8b949e';
    ctx.fillText(l, 8, yy + Math.min(11, laneH - 2));
  });

  for (const c of calls) {
    const yy = y(laneOf(c)) + 2;
    const hh = laneH - 6;
    if (hh <= 2) continue;
    const wx0 = x(c.enqAt), wx1 = x(c.dispAt);
    if (wx1 - wx0 > 0.5) {
      ctx.fillStyle = '#3d444d';
      ctx.fillRect(wx0, yy + hh / 3, wx1 - wx0, hh / 3);
      canvas._segs.push({ x0: wx0, x1: wx1, y0: yy, y1: yy + hh, call: c, part: 'wait' });
    }
    const rx1 = x(c.settleAt ?? t1);
    ctx.fillStyle = c.outcome ? (OUTCOME_COLOR[c.outcome] ?? '#58a6ff') : '#8b949e';
    ctx.fillRect(wx1, yy, Math.max(1, rx1 - wx1), hh);
    canvas._segs.push({ x0: wx1, x1: rx1, y0: yy, y1: yy + hh, call: c, part: 'run' });
  }
  return span;
}

function renderTasks() {
  const calls = visibleCalls().filter((c) => !state.drillTask || c.taskId === state.drillTask);
  const span = drawWaterfall(
    $('waterfall'), calls,
    state.drillTask ? `no dispatched calls for ${state.drillTask}` : 'no dispatched calls yet',
  );
  if (span) $('wfrange').textContent = `${fmt(span / 1000, 1)}s window`;
  renderTaskTables();
}

function renderTaskTables() {
  // per-task aggregates
  const byTask = new Map();
  for (const c of visibleCalls()) {
    if (!c.outcome) continue;
    const a = byTask.get(c.taskId) ?? { n: 0, fail: 0, waits: [], runs: [] };
    a.n++;
    if (c.outcome !== 'ok') a.fail++;
    if (c.waitMs !== undefined) a.waits.push(c.waitMs);
    if (c.runMs !== undefined) a.runs.push(c.runMs);
    byTask.set(c.taskId, a);
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : undefined);
  $('taskAgg').querySelector('tbody').innerHTML = [...byTask.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([t, a]) => {
      const runs = sortedRuns(a.runs);
      return `<tr data-drill="${esc(t)}" class="${state.drillTask === t ? 'sel' : ''}">
        <td>${esc(t)}</td><td>${a.n}</td><td class="${a.fail ? 'error' : ''}">${a.fail}</td>
        <td>${fmt(mean(a.waits))}</td><td>${fmt(mean(runs))}</td>
        <td>${fmt(pct(runs, 0.95))}</td><td>${fmt(Math.max(...runs, 0))}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">no settled calls</td></tr>';
  for (const tr of $('taskAgg').querySelectorAll('tr[data-drill]')) {
    tr.onclick = () => {
      state.drillTask = state.drillTask === tr.dataset.drill ? null : tr.dataset.drill;
      renderTasks();
    };
  }

  const calls = visibleCalls().filter((c) => !state.drillTask || c.taskId === state.drillTask);
  $('drill').className = state.drillTask ? 'pill on' : 'pill';
  $('drill').textContent = state.drillTask ? `drilldown: ${state.drillTask} — click again to clear` : '';
  $('tasks').querySelector('tbody').innerHTML = withGroups(calls.slice(-200).reverse(), (c) => c.sess, 8,
    (c) => `<tr><td class="muted">#${c.seq}</td><td>${esc(c.taskId)}</td>
      <td class="muted">${esc(c.poolId)}</td><td class="muted">${c.slot ?? '—'}</td>
      <td>${fmt(c.waitMs)}</td><td>${fmt(c.runMs)}</td>
      <td class="${c.outcome ?? ''}">${c.outcome ?? '…'}</td><td class="muted">${esc(c.error ?? '')}</td></tr>`)
    || '<tr><td colspan="8" class="muted">no tasks yet</td></tr>';
}

/* ── memory / islands / log ──────────────────────────────────────────────── */

function renderMemory() {
  drawLine($('memrate'), seriesFor('wr'), '#58a6ff');
  // Top-5 fields by total writes — one line each, same 60s window.
  const FIELD_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#a371f7', '#f85149'];
  const top = [...state.mem.entries()].filter(([k]) => inSel(k))
    .sort((a, b) => b[1].writes - a[1].writes).slice(0, 5);
  drawMultiLine($('memtop'), top.map(([k, m], i) => ({
    color: FIELD_COLORS[i],
    points: [...m.buckets.entries()].map(([sec, v]) => ({ sec, v })),
  })));
  $('memtopLegend').innerHTML = top.map(([k], i) =>
    `<span><i style="background:${FIELD_COLORS[i]}"></i>${esc(k.split('|').slice(1).join('|'))}</span>`).join('');

  // JS heap live lines — one per session, on the dashboard clock.
  const heapSids = [...state.sessions.keys()].filter(inSel).filter((sid) => state.heapSeries.has(sid));
  drawMultiLine($('heapline'), heapSids.map((sid) => ({
    color: appColor(state.sessions.get(sid)?.name ?? sid),
    points: [...state.heapSeries.get(sid).entries()].map(([sec, v]) => ({ sec, v })),
  })));
  $('heaplineLegend').innerHTML = heapSids.map((sid) => {
    const s = state.sessions.get(sid);
    const cur = sessHeapOf(sid);
    return `<span><i style="background:${appColor(s?.name ?? sid)}"></i>${esc(s?.name ?? sid)}${cur !== undefined ? ` ${fmtBytes(cur)}` : ''}</span>`;
  }).join('') || '<span class="muted">no heap samples yet — needs the memory probe (Chrome)</span>';

  // JS heap per execution context — measureUserAgentSpecificMemory
  // attribution; worker contexts identified by script URL.
  const SHORT_SCOPE = { DedicatedWorkerGlobalScope: 'worker', SharedWorkerGlobalScope: 'shared', Window: 'window', ServiceWorkerGlobalScope: 'sw' };
  const basename = (u) => { try { const x = new URL(u); return x.pathname.split('/').pop() || x.href; } catch { return u; } };
  const ctxRows = [];
  for (const [sid, ctx] of state.sessCtx) {
    if (state.sel !== null && sid !== state.sel) continue;
    if (state.sel === null && state.sessions.get(sid)?.closed) continue;
    for (const c of ctx) ctxRows.push({ sid, c });
  }
  ctxRows.sort((a, b) => b.c.bytes - a.c.bytes);
  $('heapctx').querySelector('tbody').innerHTML = withGroups(ctxRows.slice(0, 40), (r) => r.sid, 3, ({ sid, c }) =>
    `<tr><td class="muted">${esc(state.sessions.get(sid)?.name ?? sid)}</td>
      <td title="${esc(c.url ?? '')}"><span class="muted">${esc(SHORT_SCOPE[c.scope] ?? c.scope ?? 'ctx')}</span> ${esc(c.url ? basename(c.url) : 'unattributed')}</td>
      <td>${fmtBytes(c.bytes)}</td></tr>`,
  ) || '<tr><td colspan="3" class="muted">no heap data — needs Chrome measureUserAgentSpecificMemory</td></tr>';

  // Writes-desc within each session (withGroups preserves this order per
  // group). The same row order drives the post-insert sparkline painting.
  const sorted = [...state.mem.entries()].filter(([k]) => inSel(k))
    .map(([k, m]) => {
      const secs = [...m.buckets.keys()];
      const span = secs.length ? Math.max(...secs) - Math.min(...secs) + 1 : 1;
      const vals = [];
      if (secs.length) for (let s = Math.min(...secs); s <= Math.max(...secs); s++) vals.push(m.buckets.get(s) ?? 0);
      return { k, m, rate: m.writes / span, vals };
    })
    .sort((a, b) => b.m.writes - a.m.writes);
  $('mem').querySelector('tbody').innerHTML = withGroups(sorted, ({ k }) => sessOf(k), 7,
    ({ k, m, rate }) => {
      const id = `sp-${Math.abs([...k].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7))}`;
      return `<tr><td>${esc(k.split('|').slice(1).join('|'))}</td>
        <td class="muted">${esc(state.sessions.get(sessOf(k))?.name ?? '')}</td>
        <td>${m.writes}</td><td>${fmt(rate, 1)}</td><td>${m.version ?? '—'}</td>
        <td class="muted">${esc(m.writer ?? m.thread ?? '')}</td>
        <td><canvas class="spark" id="${id}" width="120" height="24" style="width:120px;height:24px"></canvas></td></tr>`;
    }) || '<tr><td colspan="7" class="muted">no writes</td></tr>';
  // paint sparklines post-insert, matching rendered row order
  const rendered = state.sel !== null
    ? sorted
    : [...sorted].sort((a, b) => [...state.sessions.keys()].indexOf(sessOf(a.k)) - [...state.sessions.keys()].indexOf(sessOf(b.k)));
  document.querySelectorAll('canvas.spark').forEach((c, i) => {
    if (rendered[i]) sparkline(c, rendered[i].vals);
  });
}

const VIA_COLOR = {
  mount: '#58a6ff', dispatch: '#3fb950', flush: '#8b949e',
  setSize: '#d29922', updateProps: '#a371f7', unmount: '#f85149',
};

/** The real framework marks, rendered once to data URLs for HTML surfaces —
 *  same drawFwMark the app map uses, so tables show the actual icon. */
const fwIcons = {};
function fwIconImg(fw) {
  const f = fw?.toLowerCase();
  if (!f) return '';
  if (!fwIcons[f]) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    drawFwMark(c.getContext('2d'), f, 16, 16, 13);
    fwIcons[f] = c.toDataURL();
  }
  return `<img class="fwicon" src="${fwIcons[f]}" title="${esc(fw)}" alt="${esc(fw)}">`;
}

/** Framework chip for HTML surfaces — real icon + name. */
const fwChip = (fw) =>
  fw ? `${fwIconImg(fw)} <span class="muted">${esc(fw)}</span>` : '<span class="muted">—</span>';

function renderIslands() {
  const rows = [...state.islands.entries()]
    .filter(([k]) => inSel(k))
    .sort((a, b) => a[1].seq - b[1].seq);
  $('islands').querySelector('tbody').innerHTML = withGroups(rows, ([k]) => sessOf(k), 11,
    ([k, i]) => {
      const host = i.poolId ? `${i.poolId}#0` : null;
      const wkey = i.poolId ? `${sessOf(k)}|${i.poolId}|0` : null;
      return `<tr data-inspect="${esc(k)}" class="${i.ended ? 'muted' : ''}"><td>${esc(k.split('|').slice(1).join('|'))}</td><td>${esc(i.app)}</td>
      <td>${fwChip(i.fw)}</td>
      <td class="muted">${esc(i.pid)}</td>
      <td>${host && state.workers.has(wkey) ? `<span class="wlink" data-wk="${esc(wkey)}">${esc(host)}</span>` : `<span class="muted">${host ?? '—'}</span>`}</td>
      <td>${i.tasks.length}</td><td>${i.batches}</td><td>${i.ops}</td>
      <td>${fmt(i.replayMs)}</td><td>${i.events}</td>
      <td class="${i.ended ? '' : 'ok'}">${i.ended ? 'unmounted' : 'live'}</td></tr>`;
    })
    || '<tr><td colspan="11" class="muted">no islands</td></tr>';
  for (const tr of $('islands').querySelectorAll('tr[data-inspect]')) {
    tr.onclick = (ev) => {
      // host cell cross-links to the worker inspector instead
      const link = ev.target.closest?.('.wlink');
      if (link && state.workers.has(link.dataset.wk)) {
        ev.stopPropagation();
        state.inspectWorker = link.dataset.wk;
        openSub('dashboard', 'tv-worker');
        return;
      }
      state.inspect = tr.dataset.inspect;
      openSub('dashboard', 'tv-island');
    };
  }
}

/* ── island inspector ────────────────────────────────────────────────────── */

function renderInspector() {
  const btn = $('navTopoI');
  const i = state.inspect ? state.islands.get(state.inspect) : null;
  if (!i) {
    btn.style.display = 'none';
    if (document.getElementById('tv-island').classList.contains('on')) {
      document.querySelector('.subnav button[data-sub="tv-dash"]').click();
    }
    return;
  }
  btn.style.display = '';
  btn.textContent = `Island: ${state.inspect.split('|').slice(1).join('|')}`;

  $('inspTitle').innerHTML =
    `Island inspector — <b>${esc(state.inspect.split('|').slice(1).join('|'))}</b> ` +
    `${i.fw ? fwChip(i.fw) + ' ' : ''}` +
    `<span class="muted">app ${esc(i.app)} · pid ${esc(i.pid)} · ${i.ended ? 'unmounted' : 'live'}` +
    (i.poolId ? ` · <a href="#" id="inspPoolLink" class="wlink">pool ${esc(i.poolId)} → worker</a>` : '') +
    `</span>`;
  if (i.poolId) {
    const link = $('inspPoolLink');
    if (link) link.onclick = (ev) => {
      ev.preventDefault();
      const slotKey = `${state.inspect.split('|')[0]}|${i.poolId}|0`;
      if (state.workers.has(slotKey)) {
        state.inspectWorker = slotKey;
        openSub('dashboard', 'tv-worker');
      }
    };
  }

  const rts = i.tasks;
  const failed = rts.filter((t) => t.error).length;
  const meanMs = rts.length ? rts.reduce((a, t) => a + t.ms, 0) / rts.length : 0;
  const maxMs = rts.length ? Math.max(...rts.map((t) => t.ms)) : 0;
  // The island runs on its client pool's worker (poolSize 1 → slot 0).
  const host = i.poolId ? state.workers.get(`${state.inspect.split('|')[0]}|${i.poolId}|0`) : null;
  const kpi = (v, l, cls = '') => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('inspKpis').innerHTML =
    kpi(rts.length, 'round-trips') +
    kpi(fmt(meanMs), 'avg round-trip ms') +
    kpi(fmt(maxMs), 'max round-trip ms', maxMs > 100 ? 'warn' : '') +
    kpi(i.ops, 'ops applied') +
    kpi(fmt(i.replayMs), 'replay ms total') +
    kpi(i.events, 'emits') +
    kpi(host?.heap !== undefined ? fmtBytes(host.heap) : '—', 'host heap') +
    kpi(failed, 'failed calls', failed ? 'bad' : 'good');

  drawOpTraffic(i);

  $('inspVia').querySelector('tbody').innerHTML = [...i.byVia.entries()]
    .sort((a, b) => b[1].ops - a[1].ops)
    .map(([via, v]) => `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${VIA_COLOR[via] ?? '#8b949e'};margin-right:4px"></i>${esc(via)}</td>
      <td>${v.batches}</td><td>${v.ops}</td><td>${fmt(v.replayMs)}</td></tr>`)
    .join('') || '<tr><td colspan="4" class="muted">no ops</td></tr>';

  $('inspEvents').querySelector('tbody').innerHTML = [...i.eventNames.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `<tr><td>${esc(name)}</td><td>${n}</td></tr>`)
    .join('') || '<tr><td colspan="2" class="muted">none</td></tr>';

  $('inspTasks').querySelector('tbody').innerHTML = rts.slice(-150).reverse()
    .map((t) => `<tr><td class="muted">#${t.seq}</td><td>${esc(t.method)}</td>
      <td>${fmt(t.ms)}</td><td>${t.ops ?? '—'}</td>
      <td class="${t.error ? 'error' : 'ok'}">${t.error ? 'error' : 'ok'}</td>
      <td class="muted">${esc(t.error ?? '')}</td></tr>`)
    .join('') || '<tr><td colspan="6" class="muted">no calls yet</td></tr>';
}

function drawOpTraffic(i) {
  const canvas = $('optraffic');
  const ctx = canvas.getContext('2d');
  const W = (canvas.width = canvas.clientWidth || 560);
  const H = (canvas.height = 140);
  ctx.clearRect(0, 0, W, H);
  const tl = i.timeline;
  if (!tl.length) {
    ctx.fillStyle = '#8b949e';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('no op traffic yet', 12, 20);
    return;
  }
  const max = Math.max(...tl.map((b) => b.count), 1);
  const bw = Math.max(2, W / tl.length - 1);
  tl.forEach((b, idx) => {
    const h = Math.max(1, (b.count / max) * (H - 18));
    ctx.fillStyle = VIA_COLOR[b.via] ?? '#8b949e';
    ctx.fillRect(idx * (W / tl.length), H - h, bw, h);
  });
}

const logEl = () => $('log');
const pad = (n, w = 2) => String(n).padStart(w, '0');
function logLine(sess, e) {
  const div = document.createElement('div');
  const { type, at, thread, ...rest } = e;
  // Wall-clock is dashboard receive time — emit-side `at` is a per-thread
  // performance.now() epoch, so it's shown as elapsed instead.
  const now = new Date();
  const ts = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
  div.innerHTML = `<span class="logts">${ts}</span> <span class="muted">${esc(sess.name ?? sess.id)}${thread === 'worker' ? ' ⧉' : ''}</span> ${esc(type)} <span class="muted">${esc(JSON.stringify(rest))}</span> <span class="logts">+${fmt(at / 1000, 1)}s</span>`;
  const el = logEl();
  el.appendChild(div);
  while (el.children.length > 500) el.firstChild.remove();
  el.scrollTop = el.scrollHeight;
}

/* ── app map — one world-space canvas; zoom/pan + zoom-tier clustering ───── */

const APP_COLORS = ['#3fb950', '#f0883e', '#a371f7', '#79c0ff', '#d29922', '#f85149', '#56d4dd', '#e275ad'];
const appColor = (name) => APP_COLORS[[...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0 % APP_COLORS.length];

const topo = { scale: 1, ox: 0, oy: 0, fit: true, sig: '' };

function renderTopology() {
  const canvas = $('appmap');
  if (!canvas) return;
  const sids = state.sel !== null && state.sessions.has(state.sel)
    ? [state.sel]
    : [...state.sessions.keys()].filter((id) => !state.sessions.get(id)?.closed);
  const sig = sids.join(',');
  if (sig !== topo.sig) { topo.sig = sig; topo.fit = true; }
  drawAppMap(canvas, sids);
  window.__topo = topo; // exposed for tests/debugging
}

/**
 * The worker that spawned a qualified pool: 'h1#s1~h2#s2~local' is a pool
 * minted inside worker h2#s2, whose own (qualified) pool is 'h1#s1~h2'.
 * Returns the `${sess}|${poolId}|${slot}` key or null for top-level ids.
 */
function parentWorkerKey(sid, qpid) {
  const segs = qpid.split('~');
  if (segs.length < 2) return null;
  const host = segs[segs.length - 2];
  const hi = host.lastIndexOf('#');
  if (hi < 0) return null;
  const parentPool = [...segs.slice(0, -2), host.slice(0, hi)].join('~');
  return `${sid}|${parentPool}|${host.slice(hi + 1)}`;
}

/** World-space layout: each session is one atoll cluster in a loose grid. */
function layoutWorld(sids) {
  const clusters = [];
  let maxR = 110;
  for (const sid of sids) {
    const workers = [...state.workers.entries()].filter(([k]) => sessOf(k) === sid);
    const islands = [...state.islands.entries()].filter(([k]) => sessOf(k) === sid);
    const hosted = new Map();
    const orphans = [];
    for (const [ik, i] of islands) {
      const wk = i.poolId ? `${sid}|${i.poolId}|0` : null;
      if (wk && state.workers.has(wk)) {
        const l = hosted.get(wk) ?? [];
        if (!l.length) hosted.set(wk, l);
        l.push({ ik, i });
      } else orphans.push({ ik, i });
    }
    // rim positions belong to pools, not workers — a size-N pool is one
    // socket containing N worker dots. Nested pools (poolIds qualified as
    // 'hostPool#slot~localPool' by sub-worker forwarding) don't take rim
    // sockets — they hang off their host worker instead.
    const pools = [];
    const nested = new Map();  // parent worker key → [pool group]
    const byPool = new Map();
    for (const w of workers) {
      const pk = w[0].slice(0, w[0].lastIndexOf('|'));
      let g = byPool.get(pk);
      if (!g) {
        g = { pk, poolId: pk.split('|')[1], workers: [], nested: pk.split('|')[1].includes('~') };
        byPool.set(pk, g);
        pools.push(g);
      }
      g.workers.push(w);
    }
    for (const g of [...pools]) {
      if (!g.nested) continue;
      pools.splice(pools.indexOf(g), 1);
      const pkey = parentWorkerKey(sid, g.poolId);
      const l = nested.get(pkey) ?? [];
      if (!l.length) nested.set(pkey, l);
      l.push(g);
    }
    const rimN = Math.max(pools.length + orphans.length, 1);
    const rimR = Math.max(110, rimN * 15);
    // nested worker clusters hang ~170 world units outside the island ring
    // per nesting level (orbit link + sub-orbit + island orbit)
    maxR = Math.max(maxR, rimR + (nested.size ? 170 : 0));
    clusters.push({ sid, workers, pools, islands, hosted, orphans, nested, rimN, rimR });
  }
  const cell = maxR * 2 + 280;
  const cols = Math.min(Math.max(clusters.length, 1), 4);
  clusters.forEach((c, i) => {
    c.cx = (i % cols) * cell + cell / 2;
    c.cy = Math.floor(i / cols) * cell + cell / 2;
  });
  return { clusters, width: cols * cell, height: Math.ceil(clusters.length / cols) * cell };
}

function fitTopo(canvas, world) {
  const W = canvas.clientWidth || 900;
  const H = canvas.clientHeight || 420;
  topo.scale = Math.max(0.08, Math.min(W / world.width, H / world.height, 1.4));
  topo.ox = (W - world.width * topo.scale) / 2;
  topo.oy = (H - world.height * topo.scale) / 2;
}

/** framework → [chip color, short tag] — HTML chips + fallback marks. */
const FW_BADGES = {
  react: ['#61dafb', '⚛'],
  vue: ['#42b883', 'V'],
  svelte: ['#ff3e00', 'S'],
  angular: ['#dd0031', 'A'],
  solid: ['#4f88c6', 'So'],
  vanilla: ['#f0db4f', 'JS'],
  leaflet: ['#19993b', 'L'],
};

/** Real framework marks, drawn at icon size (s ≈ node radius). */
function drawFwMark(ctx, fw, x, y, s, dead) {
  ctx.save();
  if (dead) ctx.globalAlpha = 0.35;
  switch (fw) {
    case 'react': {
      // the atom — nucleus + three orbital ellipses
      ctx.beginPath(); ctx.arc(x, y, s, 0, 7);
      ctx.fillStyle = '#22272e'; ctx.fill();
      ctx.strokeStyle = '#61dafb'; ctx.lineWidth = s * 0.13;
      for (const deg of [0, 60, 120]) {
        ctx.beginPath();
        ctx.ellipse(x, y, s * 0.95, s * 0.38, (deg * Math.PI) / 180, 0, 7);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, y, s * 0.15, 0, 7);
      ctx.fillStyle = '#61dafb'; ctx.fill();
      break;
    }
    case 'vue': {
      // nested V — green outer chevron, dark inner chevron
      const h = s * 0.92;
      ctx.beginPath();
      ctx.moveTo(x - s, y - h); ctx.lineTo(x + s, y - h); ctx.lineTo(x, y + h);
      ctx.closePath(); ctx.fillStyle = '#42b883'; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.58, y - h); ctx.lineTo(x + s * 0.58, y - h); ctx.lineTo(x, y + h * 0.14);
      ctx.closePath(); ctx.fillStyle = '#35495e'; ctx.fill();
      break;
    }
    case 'svelte': {
      ctx.beginPath(); ctx.arc(x, y, s, 0, 7);
      ctx.fillStyle = '#ff3e00'; ctx.fill();
      ctx.font = `bold ${s * 1.3}px ui-monospace, monospace`;
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.fillText('S', x, y + s * 0.06);
      break;
    }
    case 'angular': {
      // shield + A
      ctx.beginPath();
      ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.95, y - s * 0.62);
      ctx.lineTo(x + s * 0.78, y + s * 0.72); ctx.lineTo(x, y + s);
      ctx.lineTo(x - s * 0.78, y + s * 0.72); ctx.lineTo(x - s * 0.95, y - s * 0.62);
      ctx.closePath(); ctx.fillStyle = '#dd0031'; ctx.fill();
      ctx.font = `bold ${s * 1.15}px ui-monospace, monospace`;
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.fillText('A', x, y + s * 0.1);
      break;
    }
    case 'solid': {
      ctx.beginPath(); ctx.arc(x, y, s, 0, 7);
      ctx.fillStyle = '#4f88c6'; ctx.fill();
      ctx.font = `bold ${s * 1.15}px ui-monospace, monospace`;
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.fillText('S', x, y + s * 0.06);
      break;
    }
    case 'vanilla': {
      // the JS badge — yellow square, black JS
      ctx.beginPath();
      ctx.roundRect(x - s, y - s, s * 2, s * 2, s * 0.14);
      ctx.fillStyle = '#f0db4f'; ctx.fill();
      ctx.font = `bold ${s * 0.85}px ui-monospace, monospace`;
      ctx.fillStyle = '#0d1117'; ctx.textBaseline = 'middle';
      ctx.fillText('JS', x, y + s * 0.18);
      break;
    }
    case 'leaflet': {
      // green rounded square + white leaf
      ctx.beginPath();
      ctx.roundRect(x - s, y - s, s * 2, s * 2, s * 0.25);
      ctx.fillStyle = '#19993b'; ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.08, s * 0.3, s * 0.58, Math.PI / 4, 0, 7);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.45, y + s * 0.42); ctx.lineTo(x + s * 0.45, y - s * 0.48);
      ctx.strokeStyle = '#19993b'; ctx.lineWidth = s * 0.07; ctx.stroke();
      break;
    }
    default: {
      // tagged but unknown framework — green disc + first letter
      ctx.beginPath(); ctx.arc(x, y, s * 0.85, 0, 7);
      ctx.fillStyle = dead ? '#484f58' : '#3fb950'; ctx.fill();
      ctx.font = `bold ${s * 0.9}px ui-monospace, monospace`;
      ctx.fillStyle = '#0d1117'; ctx.textBaseline = 'middle';
      ctx.fillText(fw[0].toUpperCase(), x, y);
    }
  }
  ctx.restore();
  ctx.textBaseline = 'top';
}

/** The island node — the framework mark IS the dot. Untagged islands
 *  keep the plain green dot; ended islands dim. Returns the hit radius. */
function drawIslandDot(ctx, i, x, y, inv) {
  const fw = i.fw?.toLowerCase();
  if (fw) {
    drawFwMark(ctx, fw, x, y, 12 * inv, i.ended);
    return 12 * inv;
  }
  ctx.beginPath(); ctx.arc(x, y, 5.5 * inv, 0, 7);
  ctx.fillStyle = i.ended ? '#484f58' : '#3fb950';
  ctx.fill();
  return 5.5 * inv;
}

function drawAppMap(canvas, sids) {
  const ctx = canvas.getContext('2d');
  const W = (canvas.width = canvas.clientWidth || 900);
  const H = (canvas.height = canvas.clientHeight || 420);
  ctx.clearRect(0, 0, W, H);
  const world = layoutWorld(sids);
  if (topo.fit) { fitTopo(canvas, world); topo.fit = false; }

  const t = topo.scale;
  const full = t >= 0.7, mid = t >= 0.25;       // zoom tiers
  const inv = Math.min(1 / t, 3);                // keeps marks/labels screen-sized
  const nodes = [];

  ctx.save();
  ctx.translate(topo.ox, topo.oy);
  ctx.scale(t, t);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (const cl of world.clusters) {
    const { cx, cy } = cl;
    const sess = state.sessions.get(cl.sid);

    if (!mid) {
      // far tier — session collapsed to one clickable disc
      const r = cl.rimR * 0.5;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
      ctx.fillStyle = '#a371f71a'; ctx.fill();
      ctx.strokeStyle = '#a371f7'; ctx.lineWidth = 2 * inv; ctx.stroke();
      // the atoll look — the session's islands as framework marks on the rim
      const mi = Math.min(inv, r / 26);   // mark scale ~0.45× disc radius
      cl.islands.forEach(([, i], j) => {
        const a = (j / Math.max(cl.islands.length, 1)) * 2 * Math.PI - Math.PI / 2;
        drawIslandDot(ctx, i, cx + r * Math.cos(a), cy + r * Math.sin(a), mi);
      });
      ctx.beginPath(); ctx.arc(cx, cy, 8 * inv, 0, 7);
      ctx.fillStyle = '#a371f7'; ctx.fill();
      ctx.font = `${11 * inv}px ui-monospace, monospace`;
      ctx.fillStyle = '#c9d1d9';
      ctx.fillText(sess?.name ?? cl.sid, cx, cy + 14 * inv);
      ctx.fillStyle = '#8b949e';
      ctx.fillText(`${cl.pools.length} pools · ${cl.workers.length} workers · ${cl.islands.length} islands`, cx, cy + 27 * inv);
      nodes.push({ x: cx, y: cy, r, kind: 'session', key: cl.sid });
      continue;
    }

    const workerR = cl.rimR + 38;   // mid ring — workers
    const islandR = cl.rimR + 76;   // outer ring — islands
    // orbit lines — one per level, so pool/worker/island nodes sit ON them
    ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1 * inv;
    for (const r of [cl.rimR, workerR, islandR]) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
    }

    const ppos = cl.pools.map((p, idx) => {
      const a = (idx / cl.rimN) * 2 * Math.PI - Math.PI / 2;
      return { ...p, a, x: cx + cl.rimR * Math.cos(a), y: cy + cl.rimR * Math.sin(a) };
    });
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 1 * inv;
    for (const p of ppos) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke();
    }

    const font = (px) => `${px * inv}px ui-monospace, monospace`;

    /**
     * Nested workers: a pool minted inside a worker draws as a violet
     * mini-orbit centered ON the host worker's dot — the same
     * ring-around-parent grammar as session → pools → workers → islands.
     * Sub-workers fan to the sides of that orbit (perpendicular to the
     * host's radial ray) so they sit between the worker and island rings
     * instead of colliding with ring islands; each sub-worker's islands
     * get their own mini-orbit, and deeper pools recurse the same way.
     */
    const drawBranch = (pwKey, px, py, a) => {
      const ws = (cl.nested.get(pwKey) ?? [])
        .flatMap((g) => g.workers.map(([k, w]) => ({ k, w, g })));
      if (!ws.length) return;
      const br = 34;   // sub-worker orbit radius, centered on the parent
      ctx.beginPath(); ctx.arc(px, py, br, 0, 7);
      ctx.strokeStyle = '#a371f72e'; ctx.lineWidth = inv; ctx.stroke();
      ws.forEach(({ k, w, g }, j) => {
        // lateral slots: ±90° off the ray first, then further around
        const side = j % 2 === 0 ? 1 : -1;
        const step = Math.floor(j / 2) + 1;
        const th = a + side * (Math.PI / 2) * step * 0.8;
        const nx = px + br * Math.cos(th), ny = py + br * Math.sin(th);
        // spawn link — violet, distinct from pool→worker gray
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny);
        ctx.strokeStyle = '#a371f766'; ctx.lineWidth = 1.4 * inv; ctx.stroke();
        const r = 6 * inv;
        ctx.beginPath(); ctx.arc(nx, ny, r, 0, 7);
        ctx.fillStyle = w.dead ? '#484f58' : '#a371f7'; ctx.fill();
        ctx.strokeStyle = '#a371f7aa'; ctx.lineWidth = inv; ctx.stroke();
        if (full) {
          ctx.font = font(10); ctx.fillStyle = '#a371f7';
          ctx.fillText(`${g.poolId.split('~').pop()}#${k.split('|').pop()}`, nx, ny + r + 2 * inv);
        }
        nodes.push({ x: nx, y: ny, r: r + 4 * inv, kind: 'worker', key: k });
        // this sub-worker's islands orbit it — a child ring, not the main one
        const isl = cl.hosted.get(k) ?? [];
        if (isl.length) {
          ctx.beginPath(); ctx.arc(nx, ny, 28, 0, 7);
          ctx.strokeStyle = '#3fb9502a'; ctx.lineWidth = inv; ctx.stroke();
        }
        isl.forEach(({ ik, i }, jj) => {
          // fan along the spoke from the host's center to this sub-worker
          const th2 = th + (jj - (isl.length - 1) / 2) * 0.7;
          const ix = nx + 28 * Math.cos(th2), iy = ny + 28 * Math.sin(th2);
          ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(ix, iy);
          ctx.strokeStyle = `${i.ended ? '#484f58' : '#3fb950'}55`;
          ctx.lineWidth = 1.4 * inv; ctx.stroke();
          const r = drawIslandDot(ctx, i, ix, iy, inv);
          if (full) {
            ctx.fillStyle = '#8b949e';
            ctx.fillText(ik.split('|').slice(1).join('|'), ix, iy + r + 2 * inv);
          }
          nodes.push({ x: ix, y: iy, r: r + 4 * inv, kind: 'island', key: ik });
        });
        // deeper pools orbit this sub-worker the same way
        drawBranch(k, nx, ny, th);
      });
    };

    for (const p of ppos) {
      const mark = Math.max(inv, 1);
      // pool — a gray socket on the rim, the container for its workers
      const poolR = 10 * mark;
      ctx.beginPath(); ctx.arc(p.x, p.y, poolR, 0, 7);
      ctx.fillStyle = '#21262d'; ctx.fill();
      ctx.strokeStyle = '#8b949e55'; ctx.lineWidth = 1.2 * inv; ctx.stroke();
      if (full) {
        ctx.font = font(10); ctx.fillStyle = '#8b949e';
        ctx.fillText(p.poolId, p.x, p.y + poolR + 2 * inv);
      }
      const n = p.workers.length;
      p.workers.forEach(([k, w], j) => {
        // workers spread around the pool's angle on the mid ring
        const a2 = p.a + (j - (n - 1) / 2) * 0.22;
        const wx = cx + workerR * Math.cos(a2), wy = cy + workerR * Math.sin(a2);
        const r = (7 + (w.heap !== undefined ? Math.min(6, (w.heap / (80 << 20)) * 6) : 0)) * mark;
        // pool → worker link
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(wx, wy);
        ctx.strokeStyle = '#8b949e44'; ctx.lineWidth = 1.2 * inv; ctx.stroke();
        const isl = cl.hosted.get(k) ?? [];
        if (isl.length === 0) {
          // a worker hosting no islands is itself a vanilla island —
          // same mark the islands column shows
          drawFwMark(ctx, 'vanilla', wx, wy, Math.max(r, 9 * mark), w.dead);
        } else {
          ctx.beginPath(); ctx.arc(wx, wy, r, 0, 7);
          ctx.fillStyle = w.dead ? '#484f58' : '#8b949e';
          ctx.fill();
        }
        if (full) {
          ctx.font = font(10); ctx.fillStyle = '#8b949e';
          ctx.fillText(`${p.poolId}#${k.split('|').pop()}`, wx, wy + r + 2 * inv);
        }
        nodes.push({ x: wx, y: wy, r: r + 4 * inv, kind: 'worker', key: k });
        // this worker's islands spread around its angle on the outer ring —
        // marks stay visible when zoomed out (the atoll look)
        isl.forEach(({ ik, i }, jj) => {
          const a3 = a2 + (jj - (isl.length - 1) / 2) * 0.18;
          const ix = cx + islandR * Math.cos(a3), iy = cy + islandR * Math.sin(a3);
          if (full) {
            // host link — worker → its island
            ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(ix, iy);
            ctx.strokeStyle = `${i.ended ? '#484f58' : '#3fb950'}55`;
            ctx.lineWidth = 1.4 * inv; ctx.stroke();
          }
          const r = drawIslandDot(ctx, i, ix, iy, inv);
          if (full) {
            ctx.fillStyle = '#8b949e';
            ctx.fillText(ik.split('|').slice(1).join('|'), ix, iy + r + 2 * inv);
          }
          nodes.push({ x: ix, y: iy, r: r + 4 * inv, kind: 'island', key: ik });
        });
        // nested pools branch off this worker — sub-workers + their islands
        drawBranch(k, wx, wy, a2);
      });
    }
    cl.orphans.forEach(({ ik, i }, j) => {
      const a = ((cl.pools.length + j) / cl.rimN) * 2 * Math.PI - Math.PI / 2;
      const ix = cx + islandR * Math.cos(a), iy = cy + islandR * Math.sin(a);
      const r = drawIslandDot(ctx, i, ix, iy, inv);
      if (full) {
        ctx.fillStyle = '#8b949e';
        ctx.fillText(ik.split('|').slice(1).join('|'), ix, iy + r + 2 * inv);
      }
      nodes.push({ x: ix, y: iy, r: r + 4 * inv, kind: 'island', key: ik });
    });

    ctx.beginPath(); ctx.arc(cx, cy, 16 * inv, 0, 7);
    ctx.fillStyle = '#a371f7'; ctx.fill();
    ctx.font = font(11);
    ctx.fillStyle = '#c9d1d9';
    ctx.fillText(sess?.name ?? cl.sid, cx, cy + 19 * inv);
    ctx.fillStyle = '#8b949e';
    ctx.fillText('main thread', cx, cy + 32 * inv);
    if (!cl.pools.length && !cl.orphans.length) ctx.fillText('no workers or islands yet', cx, cy + 46 * inv);
    // the session hub is clickable too — same drill-in as the far-zoom disc
    nodes.push({ x: cx, y: cy, r: 16 * inv, kind: 'session', key: cl.sid });
  }

  // selection highlight — ring whatever is under inspection / selected
  for (const n of nodes) {
    const sel = (n.kind === 'worker' && n.key === state.inspectWorker)
      || (n.kind === 'island' && n.key === state.inspect)
      || (n.kind === 'session' && n.key === state.sel);
    if (!sel) continue;
    const rr = n.r + 2.5 * inv;
    ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, 7);
    ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.8 * inv; ctx.stroke();
    ctx.beginPath(); ctx.arc(n.x, n.y, rr + 3 * inv, 0, 7);
    ctx.strokeStyle = '#58a6ff44'; ctx.lineWidth = 1 * inv; ctx.stroke();
  }
  ctx.restore();
  canvas._nodes = nodes;
}

/* ── workers + worker inspector ──────────────────────────────────────────── */

function renderWorkers() {
  // pool → hosted island names — the reverse of island.poolId
  const hostedBy = new Map();
  for (const [ik, i] of state.islands) {
    if (!i.poolId) continue;
    const pk = `${sessOf(ik)}|${i.poolId}`;
    const l = hostedBy.get(pk) ?? [];
    if (!l.length) hostedBy.set(pk, l);
    l.push({ name: ik.split('|').slice(1).join('|'), fw: i.fw });
  }
  const rows = [...state.workers.entries()]
    .filter(([k]) => inSel(k))
    .sort((a, b) => {
      // pool+slot ordering within a session (session order applied by withGroups)
      const pa = a[0].split('|').slice(1).join('|'), pb = b[0].split('|').slice(1).join('|');
      return pa.localeCompare(pb, undefined, { numeric: true });
    });
  $('workers').querySelector('tbody').innerHTML = withGroups(rows, ([k]) => sessOf(k), 10,
    ([k, w]) => {
      const [, poolId, slot] = k.split('|');
      const hosted = hostedBy.get(`${sessOf(k)}|${poolId}`) ?? [];
      return `<tr data-winspect="${esc(k)}" class="${w.dead ? 'muted' : ''}">
        <td class="muted">${esc(state.sessions.get(sessOf(k))?.name ?? sessOf(k))}${state.sessions.get(sessOf(k))?.closed ? ' (ended)' : ''}</td>
        <td>${esc(poolId)}#${esc(slot)}</td>
        <td>${w.tasks}</td><td class="${w.failed ? 'error' : ''}">${w.failed}</td>
        <td class="${w.respawns ? 'timeout' : ''}">${w.respawns}</td>
        <td class="${w.errors.length ? 'error' : ''}">${w.errors.length}</td>
        <td class="${w.heap !== undefined ? '' : 'muted'}">${w.heap !== undefined ? fmtBytes(w.heap) : '—'}</td>
        <td>${hosted.length
          ? `<span class="ok">${hosted.map((h) => `${fwIconImg(h.fw)} ${esc(h.name)}`).join(', ')}</span>`
          : `<span class="muted" title="no hosted islands — plain worker">${fwIconImg('vanilla')}</span>`}</td>
        <td class="muted">${esc(w.lastTaskId || '—')}</td>
        <td class="${w.dead ? 'error' : 'ok'}">${w.dead ? 'down' : 'live'}</td></tr>`;
    }) || '<tr><td colspan="10" class="muted">no workers yet</td></tr>';
  for (const tr of $('workers').querySelectorAll('tr[data-winspect]')) {
    tr.onclick = () => {
      state.inspectWorker = tr.dataset.winspect;
      openSub('dashboard', 'tv-worker');
    };
  }
}

function renderWorkerInsp() {
  const btn = $('navTopoW');
  const k = state.inspectWorker;
  const w = k ? state.workers.get(k) : null;
  if (!w) {
    btn.style.display = 'none';
    if (document.getElementById('tv-worker').classList.contains('on')) {
      document.querySelector('.subnav button[data-sub="tv-dash"]').click();
    }
    return;
  }
  const [sess, poolId, slot] = k.split('|');
  btn.style.display = '';
  btn.textContent = `Worker: ${poolId}#${slot}`;

  // Islands hosted by this pool (for the "what is this worker" breadcrumb).
  const hosted = [...state.islands.entries()]
    .filter(([ik, i]) => sessOf(ik) === sess && i.poolId === poolId)
    .map(([ik, i]) => `${fwIconImg(i.fw)} ${esc(ik.split('|').slice(1).join('|'))}`);
  $('wkTitle').innerHTML =
    `Worker inspector — <b>${esc(poolId)} slot ${esc(slot)}</b> ` +
    `<span class="muted">${esc(state.sessions.get(sess)?.name ?? sess)} · ${w.dead ? 'down' : 'live'}` +
    (hosted.length ? ` · hosting ${hosted.join(', ')}` : '') + `</span>`;

  const uptime = (w.lastAt - w.spawnedAt) / 1000;
  const kpi = (v, l, cls = '') => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('wkKpis').innerHTML =
    kpi(w.tasks, 'tasks run') +
    kpi(w.failed, 'failed', w.failed ? 'bad' : 'good') +
    kpi(w.respawns, 'respawns', w.respawns ? 'warn' : '') +
    kpi(w.errors.length, 'errors', w.errors.length ? 'bad' : '') +
    kpi(w.heap !== undefined ? fmtBytes(w.heap) : '—', 'heap', w.heapLimit && w.heap > w.heapLimit * 0.8 ? 'bad' : '') +
    kpi(fmt(uptime, 1) + 's', 'uptime (last activity)') +
    kpi(hosted.length, 'islands hosted');

  const calls = visibleCalls().filter((c) => c.sess === sess && c.poolId === poolId && c.slot === Number(slot));
  const span = drawWaterfall($('wklane'), calls, 'no tasks dispatched to this worker yet');
  $('wkrange').textContent = span ? `${fmt(span / 1000, 1)}s window — click a segment to drill` : '';

  $('wkTasks').querySelector('tbody').innerHTML = calls.slice(-150).reverse()
    .map((c) => `<tr><td class="muted">#${c.seq}</td><td>${esc(c.taskId)}</td>
      <td>${fmt(c.waitMs)}</td><td>${fmt(c.runMs)}</td>
      <td class="${c.outcome ?? ''}">${c.outcome ?? '…'}</td><td class="muted">${esc(c.error ?? '')}</td></tr>`)
    .join('') || '<tr><td colspan="6" class="muted">no tasks</td></tr>';

  // JS heap (MB) over the last ~2min of samples — Chrome-only probe.
  drawLine(
    $('wkheap'),
    [...(w.heapSeries?.entries() ?? [])].map(([sec, v]) => ({ sec, v })).sort((a, b) => a.sec - b.sec),
    '#a371f7',
  );

  const wf = state.fetches
    .filter((f) => f.sess === sess && f.worker && f.worker.poolId === poolId && f.worker.slot === Number(slot))
    .slice(-50).reverse();
  $('wkFetch').querySelector('tbody').innerHTML = wf.map((f) => {
    const cls = f.error || f.status >= 400 ? 'error' : f.status >= 300 ? 'timeout' : 'ok';
    return `<tr data-fetch="${f.seq}"><td>${fmt(f.ms)}</td><td class="${cls}">${f.status !== undefined ? f.status : '✕'}</td>
      <td>${esc(f.method)}</td><td class="url" title="${esc(f.url)}">${esc(shortUrl(f.url))}</td>
      <td class="muted">${f.bytes !== undefined ? fmtBytes(f.bytes) : '—'}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">no fetches from this worker</td></tr>';
  for (const tr of $('wkFetch').querySelectorAll('tr[data-fetch]')) {
    tr.onclick = () => {
      state.inspectFetch = Number(tr.dataset.fetch);
      openSub('network', 'nv-req');
    };
  }

  $('wkErrors').innerHTML = w.errors.length
    ? w.errors.slice().reverse().map((x) => `<div style="padding:2px 0;border-bottom:1px dashed #21262d"><span class="error">error</span> ${esc(x.message)}</div>`).join('')
    : '<div class="muted">none</div>';
}

/* ── render dispatch ─────────────────────────────────────────────────────── */

function render() {
  renderOverview();
  renderTasks();
  renderMemory();
  renderIslands();
  renderInspector();
  renderTopology();
  renderWorkers();
  renderWorkerInsp();
  renderNetwork();
  renderFetchInsp();
  const selSess = state.sel ? state.sessions.get(state.sel) : null;
  $('scope').innerHTML = state.sel
    ? `<span class="muted">viewing</span> <span class="nm">${esc(selSess?.name ?? state.sel)}</span>` +
      `<span class="meta">${esc(selSess?.runtime ?? '')}${selSess?.closed ? ' · ended' : ''}</span>` +
      ` <a href="#" class="wlink" id="scopeAll">← all live sessions</a>`
    : `<span class="nm">all live sessions</span>` +
      `<span class="meta">${[...state.sessions.values()].filter((s) => !s.closed).length} connected — ended sessions stay in the sidebar</span>`;
  const scopeAll = $('scopeAll');
  if (scopeAll) scopeAll.onclick = (ev) => { ev.preventDefault(); state.sel = null; render(); };
  const apps = state.sel ? 1 : [...state.sessions.values()].filter((s) => !s.closed).length;
  const heapTotal = [...state.sessions.keys()].filter(inSel).reduce((a, sid) => a + (sessHeapOf(sid) ?? 0), 0);
  $('counts').textContent =
    `${apps} apps · ${[...state.islands.entries()].filter(([k, i]) => inSel(k) && !i.ended).length} islands · ${[...state.workers.entries()].filter(([k, w]) => inSel(k) && !w.dead).length} workers · ${heapTotal ? fmtBytes(heapTotal) : '—'} heap`;
  const sess = [...state.sessions.values()];
  $('sessions').innerHTML = sess.length
    ? `<div class="sess ${state.sel === null ? 'sel' : ''}" data-id=""><span class="nm">all live sessions</span></div>` +
      sess.map((s) =>
        `<div class="sess ${state.sel === s.id ? 'sel' : ''} ${s.closed ? 'muted' : ''}" data-id="${esc(s.id)}"><span class="nm">${esc(s.name ?? s.id)}</span>${s.closed ? ` <span class="pill">ended</span><span class="pin${s.pinned ? ' on' : ''}" title="${s.pinned ? 'pinned — kept after the 30min cleanup' : 'pin — keep after the 30min cleanup'}">◆</span><span class="dismiss" title="dismiss session">×</span>` : ''}<br><span class="rt">${esc(s.runtime)}${sessHeapOf(s.id) !== undefined ? ` · heap ${fmtBytes(sessHeapOf(s.id))}` : ''} · ${esc(s.hint ?? '')}</span></div>`,
      ).join('')
    : '<div class="muted">none</div>';
  for (const el of document.querySelectorAll('.sess')) {
    el.onclick = (ev) => {
      if (ev.target.classList.contains('dismiss')) {
        dismissSession(el.dataset.id);
        return;
      }
      if (ev.target.classList.contains('pin')) {
        pinSession(el.dataset.id, !state.sessions.get(el.dataset.id)?.pinned);
        return;
      }
      state.sel = el.dataset.id || null;
      render();
    };
  }
}

let raf = 0;
const scheduleRender = () => {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
};

// Keep the live charts rolling while their tab is visible, even between
// batches — cheap canvas redraws, ~1 fps. In broadcast mode this tick
// also runs the closed-session retention sweep.
setInterval(() => {
  if ($('view-network').classList.contains('on')) renderNetwork();
  if ($('view-memory').classList.contains('on')) renderMemory();
  if ($('view-dashboard').classList.contains('on')) renderTopology();
  if (BC) sweepClosed();
}, 1000);

/* ── tabs + waterfall interaction ────────────────────────────────────────── */

for (const b of document.querySelectorAll('.panels > nav button')) {
  b.onclick = () => {
    document.querySelectorAll('.panels > nav button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${b.dataset.view}`));
    render();
  };
}

/* ── app map interaction — wheel zoom, drag pan, click/double-click ─────── */

const amap = $('appmap');
if (amap) {
  let drag = null;
  amap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = amap.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const ns = Math.min(4, Math.max(0.05, topo.scale * k));
    const f = ns / topo.scale;
    topo.ox = mx - (mx - topo.ox) * f;
    topo.oy = my - (my - topo.oy) * f;
    topo.scale = ns;
    topo.fit = false;
    renderTopology();
  }, { passive: false });
  amap.addEventListener('mousedown', (e) => {
    drag = { x: e.clientX, y: e.clientY, ox: topo.ox, oy: topo.oy, moved: false };
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && dx * dx + dy * dy < 16) return;
    drag.moved = true;
    topo.ox = drag.ox + dx;
    topo.oy = drag.oy + dy;
    topo.fit = false;
    renderTopology();
  });
  window.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null;
    if (!wasClick) return;
    const r = amap.getBoundingClientRect();
    const mx = (e.clientX - r.left - topo.ox) / topo.scale;
    const my = (e.clientY - r.top - topo.oy) / topo.scale;
    const n = (amap._nodes ?? []).find((n) => (mx - n.x) ** 2 + (my - n.y) ** 2 <= n.r * n.r);
    if (!n) return;
    if (n.kind === 'session') {
      // drill into the cluster — selects the session and refits to just it
      state.sel = n.key;
      topo.fit = true;
      render();
    } else if (n.kind === 'worker') {
      state.inspectWorker = n.key;
      openSub('dashboard', 'tv-worker');
    } else {
      state.inspect = n.key;
      openSub('dashboard', 'tv-island');
    }
  });
  amap.addEventListener('dblclick', () => {
    state.sel = null;   // back out to the whole fleet
    topo.fit = true;
    render();
  });
}

// Mini mode — the flyout is small, so the app map becomes its own
// default sub-tab and gets the whole view instead of a hero strip.
if (new URLSearchParams(location.search).has('mini')) {
  const view = document.getElementById('view-dashboard');
  const subnav = view.querySelector('.subnav');
  const mapView = document.createElement('div');
  mapView.className = 'subview on';
  mapView.id = 'tv-map';
  mapView.append(view.querySelector('h2'), $('appmap'));
  view.appendChild(mapView);
  const mapBtn = document.createElement('button');
  mapBtn.dataset.sub = 'tv-map';
  mapBtn.textContent = 'Map';
  mapBtn.className = 'on';
  subnav.prepend(mapBtn);
  subnav.querySelector('[data-sub="tv-dash"]').classList.remove('on');
  document.getElementById('tv-dash').classList.remove('on');
}

for (const b of document.querySelectorAll('.subnav button')) {
  b.onclick = () => {
    const nav = b.closest('.subnav');
    nav.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    nav.parentElement.querySelectorAll(':scope > .subview')
      .forEach((v) => v.classList.toggle('on', v.id === b.dataset.sub));
    render();
  };
}

/** Open a subtab under a main view — switches main tabs first if needed. */
const openSub = (view, sub) => {
  if (!document.getElementById(`view-${view}`).classList.contains('on')) {
    document.querySelector(`.panels > nav button[data-view="${view}"]`).click();
  }
  render(); // lets the inspector renders unhide their subtab buttons
  const btn = document.querySelector(`#view-${view} .subnav button[data-sub="${sub}"]`);
  if (btn && btn.style.display !== 'none') btn.click();
};

const tip = $('tip');
const attachWaterfallHandlers = (canvas) => {
  const segAt = (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    return (canvas._segs ?? []).find((s) => mx >= s.x0 && mx <= s.x1 && my >= s.y0 && my <= s.y1);
  };
  canvas.addEventListener('mousemove', (e) => {
    const seg = segAt(e);
    if (!seg) { tip.style.display = 'none'; return; }
    const c = seg.call;
    tip.innerHTML = `<b>${esc(c.taskId)}</b> · ${esc(c.poolId)} slot ${c.slot ?? '?'}<br>
      wait ${fmt(c.waitMs)} ms · run ${fmt(c.runMs)} ms · <span class="${c.outcome ?? ''}">${c.outcome ?? 'in flight'}</span>
      ${c.error ? `<br><span class="muted">${esc(c.error)}</span>` : ''}`;
    tip.style.display = 'block';
    tip.style.left = `${e.clientX + 12}px`;
    tip.style.top = `${e.clientY + 12}px`;
  });
  canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  canvas.addEventListener('click', (e) => {
    const seg = segAt(e);
    if (seg) {
      state.drillTask = state.drillTask === seg.call.taskId ? null : seg.call.taskId;
      renderTasks();
      // A drill set from the worker lane jumps to the tasks view where the
      // filter is visible.
      if (state.drillTask && canvas.id === 'wklane') {
        document.querySelector('nav button[data-view="tasks"]').click();
      }
    }
  });
};
attachWaterfallHandlers($('waterfall'));
attachWaterfallHandlers($('wklane'));

/* ── connection ──────────────────────────────────────────────────────────── */

let viewer = null;

/**
 * Pure-client mode: the dashboard page is served on the app's own origin
 * (vite plugin mounts it at /__atoll/) and listens on the same
 * BroadcastChannel the app publishes on. There is no server-side session
 * registry — this page builds it from hello/batch/bye frames and owns
 * retention (pins + TTL) itself.
 */
const BC = window.__ATOLL_TRANSPORT === 'broadcast' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('atoll-devtools')
  : null;
// ?mini=1 — the overlay flyout: compact single-instance layout (CSS does
// the hiding; the session sidebar is meaningless for one origin's app).
if (new URLSearchParams(location.search).has('mini')) document.body.classList.add('mini');
const bcSessions = new Map(); // broadcast mode: local session registry
const CLOSED_TTL = 30 * 60 * 1000;
// Pure-client mode is structurally single-app — sessions are just this
// origin's instances, so the selector/scope title earn their space back.
if (BC) document.body.classList.add('local');

const bcSync = () => reconcileSessions([...bcSessions.values()]);

/** Broadcast-mode retention: closed unpinned sessions expire after the TTL. */
const sweepClosed = () => {
  const cutoff = Date.now() - CLOSED_TTL;
  let changed = false;
  for (const [id, s] of bcSessions) {
    if (s.closed && !s.pinned && s.closedAt !== undefined && s.closedAt < cutoff) {
      bcSessions.delete(id);
      changed = true;
    }
  }
  if (changed) { bcSync(); scheduleRender(); }
};

const dismissSession = (id) => {
  if (BC) {
    bcSessions.delete(id);
    bcSync();
    scheduleRender();
    return;
  }
  if (viewer?.readyState === WebSocket.OPEN) {
    viewer.send(JSON.stringify({ type: 'dismiss', sessionId: id }));
  }
};

const pinSession = (id, pinned) => {
  if (BC) {
    const s = bcSessions.get(id);
    if (s) { s.pinned = pinned; bcSync(); scheduleRender(); }
    return;
  }
  if (viewer?.readyState === WebSocket.OPEN) {
    viewer.send(JSON.stringify({ type: 'pin', sessionId: id, pinned }));
  }
};

function connect() {
  if (BC) {
    $('conn').textContent = 'local';
    $('conn').className = 'on';
    BC.onmessage = (msg) => {
      const data = msg.data;
      if (data.type === 'hello') {
        // a fresh hello means a new app instance — same id can't revive
        const prev = bcSessions.get(data.session.id);
        bcSessions.set(data.session.id, {
          ...data.session, closed: false, closedAt: undefined, pinned: prev?.pinned,
        });
        bcSync();
      } else if (data.type === 'bye') {
        const s = bcSessions.get(data.sessionId);
        if (s && !s.closed) { s.closed = true; s.closedAt = Date.now(); bcSync(); }
      } else if (data.type === 'batch') {
        if (!bcSessions.has(data.session.id)) {
          bcSessions.set(data.session.id, data.session);
          bcSync();
        }
        state.sessions.set(data.session.id, data.session);
        for (const e of data.events) {
          applyEvent(data.session, e);
          logLine(data.session, e);
        }
      }
      scheduleRender();
    };
    // announce — apps re-hello and replay their batch tail
    BC.postMessage({ type: 'view' });
    return;
  }
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/view`);
  viewer = ws;
  ws.onopen = () => { $('conn').textContent = 'live'; $('conn').className = 'on'; };
  ws.onclose = () => {
    $('conn').textContent = 'disconnected — retrying';
    $('conn').className = 'off';
    setTimeout(connect, 1500);
  };
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === 'sessions') {
      reconcileSessions(data.sessions);
    } else if (data.type === 'batch') {
      state.sessions.set(data.session.id, data.session);
      for (const e of data.events) {
        applyEvent(data.session, e);
        logLine(data.session, e);
      }
    }
    scheduleRender();
  };
}
connect();
