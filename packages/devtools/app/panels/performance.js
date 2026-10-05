// Performance view: main-thread responsiveness (runtime:longframe,
// runtime:frames from the jank probe) and message cost (argBytes /
// resultBytes on task events, island:ops.bytes).
//
// Time basis: event `at` is the emitting thread's clock, so every series
// here buckets on the dashboard clock (performance.now() at ingest), the
// same rule heapSeries/tput follow in main.js.

const WINDOW_MS = 60_000;
const MAX_FRAMES = 1000;      // long-frame records kept (all sessions)
const MAX_FPS = 240;          // fps samples kept per session (~4 min)
const WORST_ROWS = 15;
const COST_ROWS = 30;
const FPS_COLORS = ['#3fb950', '#79c0ff', '#a371f7', '#56d4dd', '#e275ad', '#f0883e'];

const HTML = `
  <h2>Main thread <span class="muted">— long frames and frame rate, last 60s</span></h2>
  <div class="kpis" id="pf-kpis"></div>
  <div id="pf-empty" class="muted" style="margin:8px 0"></div>
  <canvas id="pf-timeline" style="width:100%;height:150px;display:block;margin-top:10px;border:1px solid #21262d;border-radius:8px;background:#010409"></canvas>
  <div class="legend" style="margin-top:4px">
    <span><i style="background:#d29922"></i>long frame (height = duration)</span>
    <span><i style="background:#f85149"></i>blocking ≥ 100ms</span>
    <span><i style="background:#3fb950"></i>fps</span>
    <span><i style="background:#6e7681"></i>background (page hidden, ≥ 100ms script)</span>
    <span class="muted" id="pf-legend-extra"></span>
  </div>
  <h2 style="margin-top:14px">Worst long frames <span class="muted">— retained frames, longest first; scripts from Long Animation Frame attribution</span></h2>
  <table id="pf-worst"><thead><tr>
    <th>session</th><th>when</th><th>duration</th><th>blocking</th><th>top scripts</th>
  </tr></thead><tbody></tbody></table>
  <h2 style="margin-top:14px">Message cost <span class="muted">— estimated structured-clone size per message</span></h2>
  <div class="grid2">
    <div>
      <h2>Tasks <span class="muted">— args posted / result returned</span></h2>
      <table id="pf-tasks"><thead><tr>
        <th>task</th><th>calls</th><th>args avg</th><th>args max</th><th>result avg</th><th>result max</th>
      </tr></thead><tbody></tbody></table>
    </div>
    <div>
      <h2>Islands <span class="muted">— op batches worker → main</span></h2>
      <table id="pf-islands"><thead><tr>
        <th>instance</th><th>batches</th><th>avg</th><th>max</th><th>total</th>
      </tr></thead><tbody></tbody></table>
    </div>
  </div>
`;

export function setup(api) {
  const { state, $, esc, fmt, fmtBytes, inSel, key, sessOf } = api;

  /** [{ dash, sid, ms, blockingMs, scripts }] — dashboard-clock stamped. */
  let frames = [];
  /** sid → [{ dash, fps, dropped }] */
  const fps = new Map();
  /** `${sid}|${taskId}` → cost aggregate */
  const taskCost = new Map();
  /** `${sid}|${instance}` → { n, sum, max } */
  const islandCost = new Map();
  let dirty = true;

  const agg = () => ({ argN: 0, argSum: 0, argMax: 0, resN: 0, resSum: 0, resMax: 0 });

  api.onEvent((sess, e) => {
    const sid = sess.id;
    switch (e.type) {
      case 'runtime:longframe':
        if (e.worker) return;
        frames.push({ dash: performance.now(), sid, ms: e.ms, blockingMs: e.blockingMs, scripts: e.scripts, hidden: !!e.hidden });
        if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
        break;
      case 'runtime:frames': {
        if (e.worker) return;
        const list = fps.get(sid) ?? [];
        list.push({ dash: performance.now(), fps: e.fps, dropped: e.dropped });
        if (list.length > MAX_FPS) list.shift();
        fps.set(sid, list);
        break;
      }
      case 'task:dispatch': {
        if (e.argBytes === undefined) return;
        const k = key(sid, e.taskId);
        const a = taskCost.get(k) ?? agg();
        a.argN++; a.argSum += e.argBytes; if (e.argBytes > a.argMax) a.argMax = e.argBytes;
        taskCost.set(k, a);
        break;
      }
      case 'task:settle': {
        if (e.resultBytes === undefined) return;
        const k = key(sid, e.taskId);
        const a = taskCost.get(k) ?? agg();
        a.resN++; a.resSum += e.resultBytes; if (e.resultBytes > a.resMax) a.resMax = e.resultBytes;
        taskCost.set(k, a);
        break;
      }
      case 'island:ops': {
        if (e.bytes === undefined) return;
        const k = key(sid, e.instance);
        const c = islandCost.get(k) ?? { n: 0, sum: 0, max: 0 };
        c.n++; c.sum += e.bytes; if (e.bytes > c.max) c.max = e.bytes;
        islandCost.set(k, c);
        break;
      }
      default:
        return;
    }
    dirty = true;
  });

  api.onReset(() => {
    frames = [];
    fps.clear(); taskCost.clear(); islandCost.clear();
    dirty = true;
  });

  api.onReconcile((ids) => {
    frames = frames.filter((f) => ids.has(f.sid));
    for (const sid of [...fps.keys()]) if (!ids.has(sid)) fps.delete(sid);
    for (const m of [taskCost, islandCost]) for (const k of [...m.keys()]) if (!ids.has(sessOf(k))) m.delete(k);
    dirty = true;
  });

  /** Long frames in the selected sessions within the last `ms` (dashboard clock). */
  const recentFrames = (ms) => {
    const lo = performance.now() - ms;
    const out = [];
    for (let i = frames.length - 1; i >= 0 && frames[i].dash >= lo; i--) {
      if (inSel(frames[i].sid)) out.push(frames[i]);
    }
    return out;
  };

  const section = api.addView({
    id: 'performance',
    label: 'Performance',
    order: 25,
    html: HTML,
    title: 'Main-thread jank, frame rate, and message cost',
    badge: () => recentFrames(10_000).filter((f) => !f.hidden).length || null,
  });

  const visible = () => section.classList.contains('on');

  function renderKpis(all) {
    const win = all.filter((f) => !f.hidden);
    const bg = all.filter((f) => f.hidden);
    const bgScript = bg.reduce((a, f) => a + (f.scripts ? f.scripts.reduce((n, s) => n + s.ms, 0) : f.ms), 0);
    const lastSamples = [...fps.entries()].filter(([sid]) => inSel(sid)).map(([, l]) => l[l.length - 1]).filter(Boolean);
    const lo = performance.now() - WINDOW_MS;
    const winSamples = [...fps.entries()].filter(([sid]) => inSel(sid)).flatMap(([, l]) => l.filter((s) => s.dash >= lo));
    const cur = lastSamples.length ? Math.min(...lastSamples.map((s) => s.fps)) : undefined;
    const min = winSamples.length ? Math.min(...winSamples.map((s) => s.fps)) : undefined;
    const dropped = winSamples.reduce((a, s) => a + s.dropped, 0);
    const blocking = win.reduce((a, f) => a + f.blockingMs, 0);
    const worst = win.length ? Math.max(...win.map((f) => f.ms)) : undefined;
    const fpsCls = (v) => (v === undefined ? '' : v < 30 ? 'bad' : v < 50 ? 'warn' : 'good');
    $('pf-kpis').innerHTML =
      api.kpi(String(win.length), 'long frames · 60s', win.length > 10 ? 'bad' : win.length ? 'warn' : 'good') +
      api.kpi(`${Math.round(blocking)}<span class="muted" style="font-size:11px">ms</span>`, 'total blocking · 60s', blocking > 500 ? 'bad' : blocking > 0 ? 'warn' : '') +
      api.kpi(cur === undefined ? '—' : String(cur), 'fps now', fpsCls(cur)) +
      api.kpi(min === undefined ? '—' : String(min), 'min fps · 60s', fpsCls(min)) +
      api.kpi(String(dropped), 'dropped frames · 60s', dropped > 30 ? 'warn' : '') +
      api.kpi(worst === undefined ? '—' : `${worst}<span class="muted" style="font-size:11px">ms</span>`, 'worst frame · 60s', worst >= 200 ? 'bad' : worst ? 'warn' : '') +
      (bg.length
        ? api.kpi(`${bg.length}<span class="muted" style="font-size:11px"> · ${Math.round(bgScript)}ms</span>`, 'background work · 60s', '')
        : '');
    const anyFps = [...fps.keys()].some((sid) => inSel(sid));
    const anyFrames = frames.some((f) => inSel(f.sid));
    $('pf-empty').textContent = anyFps || anyFrames
      ? ''
      : 'No main-thread samples yet. The jank probe (connectDevtools `jank` option, on by default) reports long frames ' +
        '(Long Animation Frames, or longtask where unsupported) and a once-a-second fps sample from browser apps; ' +
        'Node apps and workers have no frames to report.';
  }

  function drawTimeline(win) {
    const canvas = $('pf-timeline');
    const ctx = canvas.getContext('2d');
    const W = (canvas.width = canvas.clientWidth || 560);
    const H = (canvas.height = canvas.clientHeight || 150);
    ctx.clearRect(0, 0, W, H);
    const L = 40, R = 34, T = 8, B = 16;
    const pw = W - L - R, ph = H - T - B;
    const now = performance.now();
    const x = (dash) => L + pw * (1 - (now - dash) / WINDOW_MS);
    const msMax = Math.max(100, ...win.map((f) => f.ms));
    const sids = [...fps.keys()].filter((sid) => inSel(sid));
    const fpsMax = Math.max(60, ...sids.flatMap((sid) => fps.get(sid).map((s) => s.fps)));

    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (const f of [0, 0.5, 1]) {
      const y = T + ph - f * ph;
      ctx.strokeStyle = f === 0 ? '#30363d' : '#21262d';
      ctx.beginPath(); ctx.moveTo(L, Math.round(y) + 0.5); ctx.lineTo(W - R, Math.round(y) + 0.5); ctx.stroke();
      ctx.fillStyle = '#d29922'; ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(msMax * f)}ms`, L - 4, y);
      ctx.fillStyle = '#3fb950'; ctx.textAlign = 'left';
      ctx.fillText(String(Math.round(fpsMax * f)), W - R + 4, y);
    }
    ctx.fillStyle = '#8b949e';
    ctx.textBaseline = 'top';
    for (const [ago, align] of [[60, 'left'], [30, 'center'], [0, 'right']]) {
      ctx.textAlign = align;
      ctx.fillText(ago ? `-${ago}s` : 'now', L + pw * (1 - ago / 60), T + ph + 3);
    }

    for (const f of win) {
      const bh = Math.max(2, (f.ms / msMax) * ph);
      ctx.fillStyle = f.hidden ? '#6e7681' : f.blockingMs >= 100 ? '#f85149' : '#d29922';
      ctx.fillRect(Math.round(x(f.dash)) - 1, T + ph - bh, 3, bh);
    }

    sids.forEach((sid, i) => {
      const pts = fps.get(sid).filter((s) => s.dash >= now - WINDOW_MS);
      if (!pts.length) return;
      ctx.strokeStyle = FPS_COLORS[i % FPS_COLORS.length];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((s, j) => {
        const px = x(s.dash), py = T + ph - (s.fps / fpsMax) * ph;
        j ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    });
    $('pf-legend-extra').textContent = sids.length > 1 ? `${sids.length} sessions: one fps line each` : '';
  }

  function renderWorst() {
    const now = performance.now();
    const rows = frames.filter((f) => inSel(f.sid)).sort((a, b) => b.ms - a.ms).slice(0, WORST_ROWS);
    $('pf-worst').querySelector('tbody').innerHTML = rows.length
      ? rows.map((f) => {
          const s = state.sessions.get(f.sid);
          const scripts = f.scripts?.length
            ? f.scripts.map((sc) => `<div>${sc.ms}ms <b>${esc(sc.fn || '(anonymous)')}</b> <span class="muted">${esc(shortSrc(sc.src))}</span></div>`).join('')
            : '<span class="muted">no attribution (longtask fallback or no script)</span>';
          return `<tr${f.hidden ? ' style="opacity:.6" title="page was hidden: frame length is throttling, script time is real"' : ''}>` +
            `<td class="muted">${esc(s?.name ?? f.sid)}${f.hidden ? ' · background' : ''}</td><td>${fmt((now - f.dash) / 1000, 0)}s ago</td>` +
            `<td>${f.ms}ms</td><td class="${f.blockingMs >= 100 ? 'error' : ''}">${f.blockingMs}ms</td><td>${scripts}</td></tr>`;
        }).join('')
      : '<tr><td colspan="5" class="muted">no long frames: frames over 50ms show up here with their slowest scripts</td></tr>';
  }

  function renderCost() {
    const byTask = new Map();
    for (const [k, a] of taskCost) {
      if (!inSel(k)) continue;
      const taskId = k.slice(k.indexOf('|') + 1);
      const t = byTask.get(taskId) ?? { argN: 0, argSum: 0, argMax: 0, resN: 0, resSum: 0, resMax: 0 };
      t.argN += a.argN; t.argSum += a.argSum; t.argMax = Math.max(t.argMax, a.argMax);
      t.resN += a.resN; t.resSum += a.resSum; t.resMax = Math.max(t.resMax, a.resMax);
      byTask.set(taskId, t);
    }
    const tasks = [...byTask].sort((a, b) => (b[1].argMax + b[1].resMax) - (a[1].argMax + a[1].resMax)).slice(0, COST_ROWS);
    const avg = (sum, n) => (n ? fmtBytes(Math.round(sum / n)) : '—');
    $('pf-tasks').querySelector('tbody').innerHTML = tasks.length
      ? tasks.map(([id, t]) => `<tr><td>${esc(id)}</td><td>${Math.max(t.argN, t.resN)}</td>` +
          `<td>${avg(t.argSum, t.argN)}</td><td>${t.argN ? fmtBytes(t.argMax) : '—'}</td>` +
          `<td>${avg(t.resSum, t.resN)}</td><td>${t.resN ? fmtBytes(t.resMax) : '—'}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">no sized task messages yet: task:dispatch / task:settle carry argBytes / resultBytes while devtools is on</td></tr>';

    const isl = [...islandCost].filter(([k]) => inSel(k)).sort((a, b) => b[1].max - a[1].max).slice(0, COST_ROWS);
    $('pf-islands').querySelector('tbody').innerHTML = isl.length
      ? isl.map(([k, c]) => `<tr><td>${esc(k.slice(k.indexOf('|') + 1))}</td><td>${c.n}</td>` +
          `<td>${fmtBytes(Math.round(c.sum / c.n))}</td><td>${fmtBytes(c.max)}</td><td>${fmtBytes(c.sum)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">no sized op batches yet: island:ops events carry `bytes` per batch</td></tr>';
  }

  let wasVisible = false;
  function draw() {
    const vis = visible();
    if (vis && !wasVisible) dirty = true;
    wasVisible = vis;
    if (!vis) return;
    const win = recentFrames(WINDOW_MS);
    drawTimeline(win);
    if (!dirty) return;
    dirty = false;
    renderKpis(win);
    renderWorst();
    renderCost();
  }

  let lastSel;
  api.onRender(() => {
    if (state.sel !== lastSel) { lastSel = state.sel; dirty = true; }
    draw();
  });
  // Rolling window: "ago" labels, KPIs, and the chart move with time.
  api.onTick(() => { dirty = true; draw(); });
}

/** Last path segments of a script URL, for compact attribution cells. */
function shortSrc(src) {
  if (!src) return '';
  try {
    const u = new URL(src);
    return u.pathname.split('/').slice(-2).join('/') + (u.search ? '?…' : '');
  } catch {
    return src.slice(-60);
  }
}
