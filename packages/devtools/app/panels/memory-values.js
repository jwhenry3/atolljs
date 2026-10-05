// Memory › Values: live shared-memory field values for one session, polled
// over the control channel (`memory.read`, ~2Hz, only while this sub-tab is
// visible), with snapshot/diff, dashboard-set watchpoints (`memory.watch`,
// `memory.unwatch`, `memory.watches`) and the memory:watch-hit log.

const CSS = `
.mvv-bar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; font-size:11px; }
.mvv-bar select, .mvv-bar input { background:#0d1117; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:2px 6px; font:inherit; }
.mvv-msg { color:#d29922; font-size:11px; min-height:1em; margin-bottom:6px; }
#mvvTable td.v { max-width:520px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#mvvTable td.d { color:#8b949e; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#mvvTable td.d.chg { color:#d29922; }
@keyframes mvvFlash { from { background:#1f6feb55; } to { background:transparent; } }
#mvvTable td.flash { animation: mvvFlash .9s ease-out; }
.mvv-hits { border:1px solid #21262d; border-radius:8px; max-height:220px; overflow-y:auto; padding:4px 8px; font-size:11px; }
.mvv-hits div { border-bottom:1px dashed #21262d; padding:2px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mvv-watch { display:flex; gap:6px; align-items:center; padding:2px 0; font-size:11px; }
`;

const POLL_MS = 500;
const MAX_HITS = 200;

const injectCss = () => {
  if (document.getElementById('mvv-css')) return;
  const s = document.createElement('style');
  s.id = 'mvv-css';
  s.textContent = CSS;
  document.head.appendChild(s);
};

const clock = (t) => {
  const d = new Date(t);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

export function setup(api) {
  injectCss();
  const { esc } = api;

  const div = api.addSubview('memory', {
    id: 'mv-values',
    label: 'Values',
    order: 60,
    html: `
      <h2>Live values <span class="muted">— polled at ~2Hz while this tab is open; changed cells flash</span></h2>
      <div class="mvv-bar">
        <span class="muted" id="mvvSess"></span>
        <button class="act" id="mvvSnap" title="Remember the current values; the diff column compares against them">Snapshot</button>
        <button class="act" id="mvvClearSnap">Clear snapshot</button>
        <span class="muted" id="mvvStatus"></span>
      </div>
      <div class="mvv-msg" id="mvvMsg"></div>
      <table id="mvvTable"><thead><tr>
        <th>field</th><th>contract</th><th>value</th><th>version</th><th>vs snapshot</th>
      </tr></thead><tbody></tbody></table>
      <div class="grid2" style="margin-top:14px">
        <div>
          <h2>Watchpoints <span class="muted">— fire memory:watch-hit on matching writes</span></h2>
          <div class="mvv-bar">
            <select id="mvvPath"><option value="">field…</option></select>
            <input id="mvvRule" type="text" value="change" size="14" title="change | > n | < n | >= n | <= n | == v | != v">
            <button class="act" id="mvvAdd">Add watch</button>
          </div>
          <div id="mvvWatches"><span class="muted">no watches</span></div>
          <div class="muted" style="font-size:11px;margin-top:6px">Rules: change, &gt; n, &lt; n, &gt;= n, &lt;= n, == v, != v (v as JSON, e.g. == "down"). Worker writes are checked when the main thread observes the version bump, so bursts between observations coalesce to the latest value.</div>
        </div>
        <div>
          <h2>Watch hits</h2>
          <div class="mvv-hits" id="mvvHits"><span class="muted">no hits yet</span></div>
        </div>
      </div>`,
  });
  const $ = (id) => div.querySelector(`#${id}`);
  const tbody = $('mvvTable').querySelector('tbody');

  /** rowKey `${contract}|${path}` → { tr, cells, value, version } */
  const rows = new Map();
  let snapshot = null; // { sid, at, values: Map(rowKey → value) }
  let sid = null;
  let inFlight = false;
  let lastReadAt = 0;
  let watches = [];
  const hits = [];
  let hitsRendered = -1;
  let pathsSig = '';

  const visible = () => div.classList.contains('on') && div.closest('.view')?.classList.contains('on');

  const blocked = (s) => {
    if (api.livePaused) return 'Viewing a recording: live values are unavailable.';
    if (!s) return api.liveSessions().length ? 'Several live sessions: select one in the sidebar.' : 'No live session.';
    if (api.state.sessions.get(s)?.closed) return 'Session has ended.';
    if (!api.hasCommand(s, 'memory.read')) {
      return "The app doesn't expose 'memory.read' (no shared-memory contract bound with devtools on, or an older @atolljs/core).";
    }
    return null;
  };

  const flash = (td) => {
    td.classList.remove('flash');
    void td.offsetWidth; // restart the animation
    td.classList.add('flash');
  };

  const diffCell = (rowKey, value) => {
    if (!snapshot || snapshot.sid !== sid) return ['', false];
    if (!snapshot.values.has(rowKey)) return ['new', true];
    const was = snapshot.values.get(rowKey);
    return was === value ? ['=', false] : [`was ${was}`, true];
  };

  const applyRead = (list) => {
    const seen = new Set();
    for (const r of list) {
      const rk = `${r.contract}|${r.path}`;
      seen.add(rk);
      let row = rows.get(rk);
      if (!row) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${esc(r.path)}</td><td class="muted">#${r.contract}</td><td class="v"></td><td></td><td class="d"></td>`;
        const cells = tr.querySelectorAll('td');
        row = { tr, cells, value: undefined, version: undefined };
        rows.set(rk, row);
        tbody.appendChild(tr);
      }
      if (row.value !== r.value) {
        if (row.value !== undefined) flash(row.cells[2]);
        row.cells[2].textContent = r.value;
        row.cells[2].title = r.value;
        row.value = r.value;
      }
      if (row.version !== r.version) {
        row.cells[3].textContent = String(r.version);
        row.version = r.version;
      }
      const [d, chg] = diffCell(rk, r.value);
      if (row.cells[4].textContent !== d) {
        row.cells[4].textContent = d;
        row.cells[4].title = d;
        row.cells[4].classList.toggle('chg', chg);
      }
    }
    for (const [rk, row] of rows) {
      if (!seen.has(rk)) { row.tr.remove(); rows.delete(rk); }
    }
    const paths = [...new Set(list.map((r) => r.path))].sort();
    const sig = paths.join('\n');
    if (sig !== pathsSig) {
      pathsSig = sig;
      const sel = $('mvvPath');
      const cur = sel.value;
      sel.innerHTML = '<option value="">field…</option>' + paths.map((p) => `<option>${esc(p)}</option>`).join('');
      if (paths.includes(cur)) sel.value = cur;
    }
  };

  const clearRows = () => {
    rows.clear();
    tbody.innerHTML = '';
    pathsSig = '';
  };

  const renderWatches = () => {
    const box = $('mvvWatches');
    if (!watches.length) { box.innerHTML = '<span class="muted">no watches</span>'; return; }
    box.innerHTML = watches.map((w) =>
      `<div class="mvv-watch"><b>${esc(w.path)}</b> <span>${esc(w.rule)}</span> <span class="muted">${w.hits} hit(s)</span>` +
      `<button class="act" data-unwatch="${esc(w.path)}">remove</button></div>`).join('');
  };

  const refreshWatches = () => {
    if (blocked(sid)) return;
    api.control(sid, 'memory.watches', {}, 3000).then((list) => { watches = list; renderWatches(); }).catch(() => {});
  };

  const poll = () => {
    if (!visible()) return;
    const next = api.selectedOrOnlyLive();
    if (next !== sid) {
      sid = next;
      clearRows();
      watches = [];
      renderWatches();
      refreshWatches();
      hitsRendered = -1;
    }
    const reason = blocked(sid);
    $('mvvMsg').textContent = reason ?? '';
    $('mvvSess').textContent = sid ? `session ${api.state.sessions.get(sid)?.name ?? sid}` : '';
    for (const b of [$('mvvSnap'), $('mvvAdd')]) b.disabled = reason !== null;
    renderHits();
    if (reason || inFlight) return;
    inFlight = true;
    const asked = sid;
    api.control(sid, 'memory.read', {}, 3000)
      .then((list) => {
        if (asked !== sid) return;
        applyRead(list);
        lastReadAt = Date.now();
        $('mvvStatus').textContent = `${list.length} field(s) · read ${clock(lastReadAt)}` +
          (snapshot && snapshot.sid === sid ? ` · snapshot ${clock(snapshot.at)}` : '');
      })
      .catch((err) => { $('mvvStatus').textContent = `error: ${err.message}`; })
      .finally(() => { inFlight = false; });
  };
  setInterval(poll, POLL_MS);

  const takeSnapshot = () => {
    if (!sid) return;
    snapshot = { sid, at: Date.now(), values: new Map([...rows].map(([rk, r]) => [rk, r.value])) };
    for (const [rk, r] of rows) {
      const [d, chg] = diffCell(rk, r.value);
      r.cells[4].textContent = d;
      r.cells[4].classList.toggle('chg', chg);
    }
  };
  const clearSnapshot = () => {
    snapshot = null;
    for (const r of rows.values()) { r.cells[4].textContent = ''; r.cells[4].classList.remove('chg'); }
  };

  $('mvvSnap').onclick = takeSnapshot;
  $('mvvClearSnap').onclick = clearSnapshot;
  $('mvvAdd').onclick = () => {
    const path = $('mvvPath').value;
    const rule = $('mvvRule').value.trim() || 'change';
    if (!path || blocked(sid)) return;
    api.control(sid, 'memory.watch', { path, rule }, 3000)
      .then((list) => { watches = list; renderWatches(); $('mvvMsg').textContent = ''; })
      .catch((err) => { $('mvvMsg').textContent = err.message; });
  };
  $('mvvWatches').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-unwatch]');
    if (!b || blocked(sid)) return;
    api.control(sid, 'memory.unwatch', { path: b.dataset.unwatch }, 3000)
      .then((list) => { watches = list; renderWatches(); })
      .catch((err) => { $('mvvMsg').textContent = err.message; });
  });

  /* ── watch-hit log ─────────────────────────────────────────────────────── */

  api.onEvent((s, e) => {
    if (e.type !== 'memory:watch-hit') return;
    hits.unshift({ t: Date.now(), sid: s.id, path: e.path, version: e.version, value: e.value, rule: e.rule });
    if (hits.length > MAX_HITS) hits.pop();
    const w = watches.find((x) => x.path === e.path);
    if (w && s.id === sid) { w.hits++; renderWatches(); }
  });

  function renderHits() {
    if (hitsRendered === hits.length + (hits[0]?.t ?? 0)) return;
    hitsRendered = hits.length + (hits[0]?.t ?? 0);
    const mine = sid ? hits.filter((h) => h.sid === sid) : hits;
    $('mvvHits').innerHTML = mine.slice(0, 100).map((h) =>
      `<div><span class="logts">${clock(h.t)}</span> <b>${esc(h.path)}</b> ${esc(h.rule)} → ${esc(h.value)} <span class="muted">v${h.version}</span></div>`,
    ).join('') || '<span class="muted">no hits yet</span>';
  }
  api.onRender(() => { if (visible()) renderHits(); });

  api.onReset(() => {
    clearRows();
    snapshot = null;
    hits.length = 0;
    hitsRendered = -1;
    watches = [];
    sid = null;
    renderWatches();
  });

  /* ── palette ───────────────────────────────────────────────────────────── */

  const openValues = () => api.openSub('memory', 'mv-values');
  api.addPaletteItem({ id: 'memory.values', title: 'Memory: open live values', group: 'Memory', run: openValues });
  api.addPaletteItem({
    id: 'memory.snapshot',
    title: 'Memory: snapshot values',
    group: 'Memory',
    hint: 'diff column compares against it',
    run: () => {
      openValues();
      // values land on the next poll when the tab was just opened
      if (rows.size) takeSnapshot(); else setTimeout(takeSnapshot, POLL_MS * 2);
    },
  });
  api.addPaletteItem({ id: 'memory.clearSnapshot', title: 'Memory: clear values snapshot', group: 'Memory', run: clearSnapshot });
}
