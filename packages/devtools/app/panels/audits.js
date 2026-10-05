// Audits: live recommendations over the event stream. Keeps its own bounded
// aggregates (dashboard clock: performance.now() at ingest, since event `at`
// epochs differ per thread), re-runs the pure rules in ./audit-rules.js at
// most once a second, and renders findings as cards with entity chips that
// open the matching inspector.
import { runAudits, ruleCoverage, RULES, WINDOW_MS } from './audit-rules.js';

/** Series older than this are trimmed on each tick (rules look back ≤ WINDOW_MS). */
const KEEP_MS = Math.max(WINDOW_MS, 60_000) * 2;
/** Per-series sample cap, independent of age. */
const CAP = 2000;
/** Pending (enqueued, not yet dispatched/settled) call ids tracked per pool. */
const PENDING_CAP = 5000;
const MUTE_KEY = 'atoll.devtools.audits.muted';
const SEV_LABEL = { error: 'Errors', warn: 'Warnings', info: 'Info' };

const push = (arr, x, cap = CAP) => {
  arr.push(x);
  if (arr.length > cap * 1.25) arr.splice(0, arr.length - cap);
};
const trim = (arr, cutoff) => {
  let i = 0;
  while (i < arr.length && (arr[i].t ?? arr[i]) < cutoff) i++;
  if (i) arr.splice(0, i);
};

export function setup(api) {
  const { esc } = api;
  const now = () => performance.now();

  /* ── aggregates ─────────────────────────────────────────────────────── */

  const agg = {
    sessions: new Map(), // sid → { longframes, frames, heap?, heapLimit? }
    pools: new Map(),    // `${sid}|${poolId}`
    tasks: new Map(),    // `${sid}|${poolId}|${taskId}`
    workers: new Map(),  // `${sid}|${poolId}|${slot}`
    islands: new Map(),  // `${sid}|${instance}`
    mem: new Map(),      // `${sid}|${path}`
    fetches: [],
  };

  const sessAgg = (sid) => {
    let s = agg.sessions.get(sid);
    if (!s) agg.sessions.set(sid, (s = { longframes: [], frames: [] }));
    return s;
  };
  const poolAgg = (sid, poolId) => {
    const key = `${sid}|${poolId}`;
    let p = agg.pools.get(key);
    if (!p) {
      p = {
        key, sid, poolId, initSeen: false, firstAt: now(), taskEvents: 0,
        dispatches: [], runs: [], pending: new Set(), backlogSeries: [],
      };
      agg.pools.set(key, p);
    }
    return p;
  };
  const taskAgg = (sid, poolId, taskId) => {
    const key = `${sid}|${poolId}|${taskId}`;
    let t = agg.tasks.get(key);
    if (!t) agg.tasks.set(key, (t = { key, sid, poolId, taskId, settles: [], argBytes: [], resultBytes: [] }));
    return t;
  };
  const workerAgg = (sid, poolId, slot) => {
    const key = `${sid}|${poolId}|${slot}`;
    let w = agg.workers.get(key);
    if (!w) agg.workers.set(key, (w = { key, sid, poolId, slot, respawns: [] }));
    return w;
  };
  const islandAgg = (sid, instance) => {
    const key = `${sid}|${instance}`;
    let i = agg.islands.get(key);
    if (!i) agg.islands.set(key, (i = { key, sid, instance, mounted: false, ended: false, batches: [] }));
    return i;
  };

  api.onEvent((session, e) => {
    const sid = session.id;
    const t = now();
    switch (e.type) {
      case 'pool:init': {
        const p = poolAgg(sid, e.poolId);
        Object.assign(p, {
          initSeen: true, label: e.label, poolSize: e.poolSize, concurrency: e.concurrency,
          dedicated: e.dedicated === true, dead: false, firstAt: t,
        });
        break;
      }
      case 'pool:terminate': {
        const p = agg.pools.get(`${sid}|${e.poolId}`);
        if (p) { p.dead = true; p.pending.clear(); }
        break;
      }
      case 'worker:respawn':
        push(workerAgg(sid, e.poolId, e.slot).respawns, t, 200);
        break;
      case 'worker:error':
        workerAgg(sid, e.poolId, e.slot).lastError = e.message;
        break;
      case 'task:enqueue': {
        const p = poolAgg(sid, e.poolId);
        p.taskEvents++;
        p.pending.add(e.callId);
        if (p.pending.size > PENDING_CAP) p.pending.delete(p.pending.values().next().value);
        break;
      }
      case 'task:dispatch': {
        const p = poolAgg(sid, e.poolId);
        p.taskEvents++;
        p.pending.delete(e.callId);
        push(p.dispatches, { t, waitMs: e.waitMs });
        if (e.argBytes !== undefined) push(taskAgg(sid, e.poolId, e.taskId).argBytes, { t, v: e.argBytes });
        break;
      }
      case 'task:settle': {
        const p = poolAgg(sid, e.poolId);
        p.taskEvents++;
        p.pending.delete(e.callId);
        if (e.runMs !== undefined) push(p.runs, { t, runMs: e.runMs });
        const tk = taskAgg(sid, e.poolId, e.taskId);
        push(tk.settles, { t, outcome: e.outcome, error: e.error });
        if (e.resultBytes !== undefined) push(tk.resultBytes, { t, v: e.resultBytes });
        break;
      }
      case 'island:mount': {
        const i = islandAgg(sid, e.instance);
        Object.assign(i, { app: e.app, framework: e.framework, mounted: true, ended: false });
        if (e.poolId) i.poolId = e.poolId;
        break;
      }
      case 'island:unmount':
        islandAgg(sid, e.instance).ended = true;
        break;
      case 'island:ops':
        push(islandAgg(sid, e.instance).batches, { t, count: e.count, bytes: e.bytes, replayMs: e.replayMs }, 500);
        break;
      case 'memory:write': {
        const k = `${sid}|${e.path}`;
        let m = agg.mem.get(k);
        if (!m) agg.mem.set(k, (m = { key: k, sid, path: e.path, perSec: [] }));
        const sec = Math.floor(t / 1000) * 1000;
        const last = m.perSec[m.perSec.length - 1];
        if (last && last.t === sec) last.v++;
        else push(m.perSec, { t: sec, v: 1 }, 120);
        break;
      }
      case 'runtime:memory': {
        if (e.worker) {
          const w = workerAgg(sid, e.worker.poolId, e.worker.slot);
          w.heap = e.heapBytes; w.heapLimit = e.heapLimitBytes;
        } else {
          const s = sessAgg(sid);
          // measureUserAgentSpecificMemory's heapBytes is the whole agent
          // cluster; compare only the window contexts against the limit.
          const win = e.contexts?.filter((c) => c.scope === 'Window');
          s.heap = e.contexts ? (win.length ? win.reduce((a, c) => a + c.bytes, 0) : undefined) : e.heapBytes;
          s.heapLimit = e.heapLimitBytes;
        }
        break;
      }
      case 'runtime:longframe':
        push(sessAgg(sid).longframes, { t, ms: e.ms, blockingMs: e.blockingMs, scripts: e.scripts, hidden: !!e.hidden }, 500);
        break;
      case 'runtime:frames':
        push(sessAgg(sid).frames, { t, fps: e.fps, dropped: e.dropped }, 300);
        break;
      case 'net:fetch':
        push(agg.fetches, { sid, t, url: e.url, method: e.method, status: e.status, ms: e.ms, error: e.error }, 300);
        break;
    }
  });

  const clearAll = () => {
    for (const v of Object.values(agg)) {
      if (v instanceof Map) v.clear(); else v.length = 0;
    }
    findings = [];
    lastRun = 0;
  };
  api.onReset(clearAll);
  api.onReconcile((ids) => {
    for (const map of [agg.pools, agg.tasks, agg.workers, agg.islands, agg.mem]) {
      for (const [k, v] of map) if (!ids.has(v.sid)) map.delete(k);
    }
    for (const sid of [...agg.sessions.keys()]) if (!ids.has(sid)) agg.sessions.delete(sid);
    agg.fetches = agg.fetches.filter((f) => ids.has(f.sid));
  });

  /** Age out old samples and record each pool's backlog depth (1Hz). */
  const maintain = (t) => {
    const cutoff = t - KEEP_MS;
    for (const p of agg.pools.values()) {
      trim(p.dispatches, cutoff); trim(p.runs, cutoff); trim(p.backlogSeries, cutoff);
      push(p.backlogSeries, { t, v: p.pending.size }, 120);
    }
    for (const tk of agg.tasks.values()) { trim(tk.settles, cutoff); trim(tk.argBytes, cutoff); trim(tk.resultBytes, cutoff); }
    for (const w of agg.workers.values()) trim(w.respawns, cutoff);
    for (const i of agg.islands.values()) trim(i.batches, cutoff);
    for (const m of agg.mem.values()) trim(m.perSec, cutoff);
    for (const s of agg.sessions.values()) { trim(s.longframes, cutoff); trim(s.frames, cutoff); }
    trim(agg.fetches, cutoff);
  };

  /** The rules' input, scoped to the selected session(s). */
  const buildSnapshot = (t) => {
    const sel = (sid) => api.inSel(sid);
    const sessions = [...api.state.sessions.values()].filter((s) => sel(s.id)).map((s) => {
      const a = agg.sessions.get(s.id);
      return {
        id: s.id, name: s.name, runtime: s.runtime, closed: s.closed, env: s.env,
        heap: a?.heap, heapLimit: a?.heapLimit, longframes: a?.longframes ?? [], frames: a?.frames ?? [],
      };
    });
    return {
      now: t,
      sessions,
      pools: [...agg.pools.values()].filter((p) => sel(p.sid)).map((p) => ({ ...p, backlog: p.pending.size })),
      tasks: [...agg.tasks.values()].filter((x) => sel(x.sid)),
      workers: [...agg.workers.values()].filter((x) => sel(x.sid)),
      islands: [...agg.islands.values()].filter((x) => sel(x.sid)),
      memFields: [...agg.mem.values()].filter((x) => sel(x.sid)),
      fetches: agg.fetches.filter((f) => sel(f.sid)),
    };
  };

  /* ── mute state (localStorage) ──────────────────────────────────────── */

  const loadMuted = () => {
    try { return new Set(JSON.parse(localStorage.getItem(MUTE_KEY) ?? '[]')); } catch { return new Set(); }
  };
  const muted = loadMuted();
  const saveMuted = () => {
    try { localStorage.setItem(MUTE_KEY, JSON.stringify([...muted])); } catch { /* storage unavailable */ }
  };

  /* ── run loop ───────────────────────────────────────────────────────── */

  let findings = [];
  let coverage = {};
  let lastRun = 0;
  let lastSel;
  let dirty = true;
  let filter = 'all';

  const run = () => {
    const t = now();
    const snap = buildSnapshot(t);
    findings = runAudits(snap);
    coverage = ruleCoverage(snap);
    lastRun = t;
    lastSel = api.state.sel;
    dirty = true;
  };

  api.onTick(() => {
    maintain(now());
    run();
    if (section.classList.contains('on')) paint();
  });
  api.onRender(() => {
    // Selection changes re-run early, still capped at once a second.
    if (api.state.sel !== lastSel && now() - lastRun >= 1000) run();
    if (dirty && section.classList.contains('on')) paint();
  });

  /* ── view ───────────────────────────────────────────────────────────── */

  const active = () => findings.filter((f) => !muted.has(f.rule));
  const section = api.addView({
    id: 'audits',
    label: 'Audits',
    order: 80,
    title: 'Live recommendations: pool sizing, message cost, jank, errors, isolation',
    badge: () => active().filter((f) => f.severity !== 'info').length || null,
    html: `
<style>
  #view-audits .au-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0; }
  #view-audits .au-bar button.on { border-color: #58a6ff; color: #c9d1d9; }
  #view-audits .au-card { border: 1px solid #21262d; border-left: 3px solid #8b949e; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
  #view-audits .au-card.error { border-left-color: #f85149; }
  #view-audits .au-card.warn { border-left-color: #d29922; }
  #view-audits .au-card.info { border-left-color: #58a6ff; }
  #view-audits .au-top { display: flex; align-items: baseline; gap: 8px; }
  #view-audits .au-title { font-weight: 600; flex: 1; }
  #view-audits .au-sev { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
  #view-audits .au-sev.error { color: #f85149; } #view-audits .au-sev.warn { color: #d29922; } #view-audits .au-sev.info { color: #58a6ff; }
  #view-audits .au-detail { margin: 4px 0; }
  #view-audits .au-fix { margin: 4px 0; color: #c9d1d9; }
  #view-audits .au-fix b { color: #3fb950; font-weight: 600; }
  #view-audits code { background: #161b22; border: 1px solid #21262d; border-radius: 4px; padding: 0 4px; font-size: 11px; }
  #view-audits .au-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  #view-audits .au-chip { border: 1px solid #30363d; border-radius: 10px; padding: 0 8px; font-size: 11px; background: none; color: #58a6ff; cursor: pointer; }
  #view-audits .au-chip:hover { border-color: #58a6ff; }
  #view-audits .au-chip i { color: #8b949e; font-style: normal; margin-right: 4px; }
  #view-audits .au-mute { background: none; border: 1px solid #30363d; border-radius: 4px; color: #8b949e; cursor: pointer; font-size: 10px; padding: 1px 6px; }
  #view-audits .au-mute:hover { color: #c9d1d9; border-color: #8b949e; }
  #view-audits .au-empty { color: #8b949e; padding: 24px 0; text-align: center; }
  #view-audits .au-muted { margin-top: 14px; }
  #view-audits .au-muted li { margin: 2px 0; }
  #view-audits details { margin-top: 14px; }
  #view-audits .au-cov { font-size: 10px; }
</style>
<div class="kpis" id="auKpis"></div>
<div class="au-bar" id="auFilter">
  <button class="act on" data-f="all">All</button>
  <button class="act" data-f="error">Errors</button>
  <button class="act" data-f="warn">Warnings</button>
  <button class="act" data-f="info">Info</button>
  <span class="muted" id="auScope"></span>
</div>
<div id="auList"></div>
<div class="au-muted" id="auMuted"></div>
<details id="auRules">
  <summary class="muted">What each rule needs</summary>
  <table class="tkv"><tbody id="auRulesBody"></tbody></table>
</details>`,
  });

  const $ = (id) => section.querySelector(`#${id}`);
  const code = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  const ruleTitle = (id) => RULES.find((r) => r.id === id)?.title ?? id;

  const paint = () => {
    dirty = false;
    const act = active();
    const counts = { error: 0, warn: 0, info: 0 };
    for (const f of act) counts[f.severity]++;
    $('auKpis').innerHTML =
      api.kpi(counts.error, 'errors', counts.error ? 'bad' : 'good') +
      api.kpi(counts.warn, 'warnings', counts.warn ? 'warn' : 'good') +
      api.kpi(counts.info, 'info') +
      api.kpi(muted.size, 'muted rules');
    const sel = api.state.sel ? api.state.sessions.get(api.state.sel) : null;
    $('auScope').textContent = sel
      ? `session: ${sel.name ?? sel.id}`
      : 'all live sessions';
    for (const b of $('auFilter').querySelectorAll('button[data-f]')) {
      b.classList.toggle('on', b.dataset.f === filter);
      const n = b.dataset.f === 'all' ? act.length : counts[b.dataset.f];
      b.textContent = `${b.dataset.f === 'all' ? 'All' : SEV_LABEL[b.dataset.f]} (${n})`;
    }

    const shown = filter === 'all' ? act : act.filter((f) => f.severity === filter);
    $('auList').innerHTML = shown.length
      ? shown.map((f) => `
<div class="au-card ${f.severity}">
  <div class="au-top">
    <span class="au-sev ${f.severity}">${f.severity}</span>
    <span class="au-title">${esc(f.title)}</span>
    <button class="au-mute" data-mute="${esc(f.rule)}" title="Mute every '${esc(ruleTitle(f.rule))}' finding">mute rule</button>
  </div>
  <div class="au-detail muted">${code(f.detail)}</div>
  <div class="au-fix"><b>Fix:</b> ${code(f.fix)}</div>
  ${f.docs ? `<a class="wlink" href="${esc(f.docs.href)}" target="_blank" rel="noopener">${esc(f.docs.label)} ↗</a>` : ''}
  ${f.entities?.length ? `<div class="au-chips">${f.entities.map((en) =>
    `<button class="au-chip" data-kind="${en.kind}" data-key="${esc(en.key)}" title="Open ${en.kind}"><i>${en.kind}</i>${esc(en.label)}</button>`).join('')}</div>` : ''}
  <div class="muted" style="font-size:10px;margin-top:4px">rule: ${esc(f.rule)}</div>
</div>`).join('')
      : `<div class="au-empty">${act.length ? 'No findings at this severity.' : 'No issues found — audits re-run every second over live data'}</div>`;

    const mutedCounts = new Map();
    for (const f of findings) if (muted.has(f.rule)) mutedCounts.set(f.rule, (mutedCounts.get(f.rule) ?? 0) + 1);
    $('auMuted').innerHTML = muted.size
      ? `<div class="muted">Muted rules</div><ul>${[...muted].map((r) =>
        `<li>${esc(ruleTitle(r))} <span class="muted">(${esc(r)}${mutedCounts.get(r) ? `, ${mutedCounts.get(r)} hidden` : ''})</span>
          <button class="au-mute" data-unmute="${esc(r)}">unmute</button></li>`).join('')}</ul>`
      : '';

    $('auRulesBody').innerHTML = RULES.map((r) => `<tr>
      <td>${esc(r.title)}<div class="muted au-cov">${esc(r.id)}</div></td>
      <td>${esc(r.needs)} <span class="au-cov ${coverage[r.id] ? 'ok' : 'muted'}">${coverage[r.id] ? '● data seen' : '○ waiting for data'}</span>${muted.has(r.id) ? ' <span class="pill">muted</span>' : ''}</td>
    </tr>`).join('');
  };

  const openEntity = (kind, key) => {
    const st = api.state;
    if (kind === 'worker') {
      st.inspectWorker = key;
      api.openSub('dashboard', 'tv-worker');
    } else if (kind === 'island') {
      st.inspect = key;
      api.openSub('dashboard', 'tv-island');
    } else if (kind === 'pool') {
      const wk = [...st.workers.keys()].filter((k) => k.startsWith(`${key}|`));
      const live = wk.find((k) => !st.workers.get(k)?.dead) ?? wk[0];
      if (live) {
        st.inspectWorker = live;
        api.openSub('dashboard', 'tv-worker');
      } else {
        api.openView('dashboard');
      }
    } else if (kind === 'session') {
      st.sel = key;
      api.render();
    }
  };

  section.addEventListener('click', (e) => {
    const t = e.target.closest?.('button');
    if (!t || !section.contains(t)) return;
    if (t.dataset.f) {
      filter = t.dataset.f;
      paint();
    } else if (t.dataset.mute) {
      muted.add(t.dataset.mute); saveMuted(); paint(); api.render();
    } else if (t.dataset.unmute) {
      muted.delete(t.dataset.unmute); saveMuted(); paint(); api.render();
    } else if (t.dataset.kind) {
      openEntity(t.dataset.kind, t.dataset.key);
    }
  });

  /* ── palette ────────────────────────────────────────────────────────── */

  api.addPaletteItem({
    id: 'audits.show',
    title: 'Audits: show issues',
    group: 'Audits',
    hint: 'live recommendations',
    run: () => { filter = 'all'; api.openView('audits'); },
  });
  api.addPaletteItem({
    id: 'audits.errors',
    title: 'Audits: show errors only',
    group: 'Audits',
    run: () => { filter = 'error'; api.openView('audits'); },
  });
  api.addPaletteItem({
    id: 'audits.unmute',
    title: 'Audits: unmute all rules',
    group: 'Audits',
    run: () => { muted.clear(); saveMuted(); api.openView('audits'); },
  });

  run();
}
