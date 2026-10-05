// Reactivity view: the cross-thread dependency graph from reactive:node
// events. Lanes are owners: 'shared memory' (field sources, ids `mem:<path>`
// shared by every thread), the main thread, and each worker slot (from the
// pool's forwarding stamp). Edges run dep → dependent; disposed nodes fade.
//
// Non-source ids are per-thread counters, so they're qualified here by
// lane: `main/e3`, `pool-1#0/b2`. Sources stay global so a worker-side
// writer's field and a main-thread watcher meet at one node.

const CSS = `
.rx-bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:11px; margin-bottom:8px; }
.rx-wrap { display:grid; grid-template-columns: minmax(0,1fr) 280px; gap:10px; }
.rx-graph { border:1px solid #21262d; border-radius:8px; background:#010409; overflow:auto; max-height:560px; min-height:200px; }
.rx-graph svg { display:block; }
.rx-graph .n { cursor:pointer; }
.rx-graph .n rect { stroke-width:1; }
.rx-graph .n.sel rect { stroke:#f0f6fc; stroke-width:2; }
.rx-graph .n.off { opacity:.3; }
.rx-graph text { font:11px ui-monospace,monospace; fill:#c9d1d9; pointer-events:none; }
.rx-graph .lane { font-size:10px; fill:#8b949e; text-transform:uppercase; letter-spacing:.06em; }
.rx-graph path.e { fill:none; stroke:#30363d; stroke-width:1.2; }
.rx-graph path.e.hot { stroke:#58a6ff; stroke-width:2; }
.rx-graph path.e.off { opacity:.25; }
.rx-detail { border:1px solid #21262d; border-radius:8px; padding:8px 10px; font-size:11px; max-height:560px; overflow:auto; }
.rx-empty { padding:16px; color:#8b949e; font-size:12px; line-height:1.6; }
.rx-legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin:0 4px 0 10px; vertical-align:middle; }
`;

const KIND = {
  source: { color: '#d29922', order: 0 },
  bridge: { color: '#a371f7', order: 1 },
  derived: { color: '#58a6ff', order: 2 },
  effect: { color: '#3fb950', order: 3 },
};
const SHARED = 'shared memory';
const MAX_DISPOSED = 300;
const COL_W = 230, BOX_W = 196, BOX_H = 22, ROW_H = 30, TOP = 30, LEFT = 14;

const injectCss = () => {
  if (document.getElementById('rx-css')) return;
  const s = document.createElement('style');
  s.id = 'rx-css';
  s.textContent = CSS;
  document.head.appendChild(s);
};

export function setup(api) {
  injectCss();
  const { esc } = api;

  const section = api.addView({
    id: 'reactivity',
    label: 'Reactivity',
    order: 45,
    html: `
      <h2>Reactivity graph <span class="muted">— shared-memory sources → version bridges → slices → effects, laned by thread</span></h2>
      <div class="rx-bar">
        <label><input type="checkbox" id="rxDisposed" checked> show disposed</label>
        <button class="act" id="rxSnap" title="Fetch the main thread's live nodes (reactive.nodes): for dashboards opened after the creation events scrolled out of the replay tail">Load snapshot</button>
        <span class="muted" id="rxStats"></span>
        <span class="rx-legend">${Object.entries(KIND).map(([k, v]) => `<i style="background:${v.color}"></i>${k}`).join('')}</span>
      </div>
      <div class="rx-wrap">
        <div class="rx-graph" id="rxGraph"></div>
        <div class="rx-detail" id="rxDetail"><span class="muted">click a node for details</span></div>
      </div>`,
  });
  const $ = (id) => section.querySelector(`#${id}`);

  /** `${sid}|${qid}` → node record */
  const nodes = new Map();
  let version = 0;
  let drawn = -1;
  let selected = null;

  const laneOf = (e) => (e.worker ? `${e.worker.poolId}#${e.worker.slot}` : e.thread === 'main' ? 'main' : 'worker');
  const qualify = (lane, id) => (id.startsWith('mem:') ? id : `${lane}/${id}`);

  const upsert = (sid, raw, lane, at) => {
    const qid = qualify(lane, raw.id);
    const k = api.key(sid, qid);
    const prev = nodes.get(k);
    const n = prev ?? { key: k, sid, qid, id: raw.id, createdAt: at, seq: version };
    n.kind = raw.kind;
    if (raw.label !== undefined) n.label = raw.label;
    if (raw.deps !== undefined) n.deps = raw.deps.map((d) => qualify(lane, d));
    n.deps ??= [];
    n.lane = raw.kind === 'source' ? SHARED : lane;
    n.owner = raw.owner;
    n.disposed = raw.disposed === true;
    if (n.disposed) n.disposedAt = at;
    nodes.set(k, n);
    version++;
  };

  const trimDisposed = (sid) => {
    const dead = [...nodes.values()].filter((n) => n.sid === sid && n.disposed);
    if (dead.length <= MAX_DISPOSED) return;
    dead.sort((a, b) => a.disposedAt - b.disposedAt);
    for (const n of dead.slice(0, dead.length - MAX_DISPOSED)) nodes.delete(n.key);
  };

  api.onEvent((s, e) => {
    if (e.type !== 'reactive:node') return;
    upsert(s.id, e, laneOf(e), Date.now());
    if (e.disposed) trimDisposed(s.id);
  });
  api.onReset(() => { nodes.clear(); version++; selected = null; });
  api.onReconcile((ids) => {
    for (const [k, n] of nodes) if (!ids.has(n.sid)) nodes.delete(k);
    version++;
  });

  $('rxDisposed').onchange = () => { drawn = -1; draw(); };
  $('rxSnap').onclick = () => {
    const sid = api.selectedOrOnlyLive();
    if (!sid || !api.hasCommand(sid, 'reactive.nodes')) {
      $('rxStats').textContent = sid ? "this app doesn't expose 'reactive.nodes' (no reactive node created with devtools on yet)" : 'select one live session first';
      return;
    }
    api.control(sid, 'reactive.nodes', {}, 3000)
      .then((list) => {
        for (const raw of list) upsert(sid, raw, 'main', Date.now());
        api.scheduleRender();
      })
      .catch((err) => { $('rxStats').textContent = `snapshot failed: ${err.message}`; });
  };

  const visibleNodes = () => {
    const showDead = $('rxDisposed').checked;
    return [...nodes.values()].filter((n) => api.inSel(n.key) && (showDead || !n.disposed));
  };

  const laneSort = (a, b) => {
    const rank = (l) => (l === SHARED ? 0 : l === 'main' ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  };

  function draw() {
    const list = visibleNodes();
    const sessions = new Set(list.map((n) => n.sid));
    const multi = sessions.size > 1;
    const laneKey = (n) => (multi ? `${api.state.sessions.get(n.sid)?.name ?? n.sid} · ${n.lane}` : n.lane);
    const lanes = [...new Set(list.map(laneKey))].sort(laneSort);
    const live = list.filter((n) => !n.disposed).length;
    $('rxStats').textContent = list.length ? `${live} live · ${list.length - live} disposed · ${lanes.length} lane(s)` : '';

    const graph = $('rxGraph');
    if (!list.length) {
      graph.innerHTML = `<div class="rx-empty">
        No reactive nodes yet.<br>
        Nodes are emitted while devtools is enabled by <code>watch()</code>, <code>observe()</code> (framework
        bindings subscribe through it) and <code>reactive().observeRemote()</code>; island push-mode doorbells
        appear as <code>observe(opsVersion)</code>. Call <code>initDevtools()</code> before those subscriptions are
        created. Opened the dashboard late? <b>Load snapshot</b> fetches the main thread's live nodes.<br>
        Worker-side nodes arrive through the event stream (the worker's devtools forwarding must be on).
      </div>`;
      return;
    }

    const pos = new Map();
    const byLane = new Map(lanes.map((l) => [l, []]));
    for (const n of list) byLane.get(laneKey(n)).push(n);
    let maxRows = 0;
    lanes.forEach((l, col) => {
      const ns = byLane.get(l).sort((a, b) => KIND[a.kind].order - KIND[b.kind].order || a.seq - b.seq);
      maxRows = Math.max(maxRows, ns.length);
      ns.forEach((n, row) => pos.set(n.qid + '|' + n.sid, { x: LEFT + col * COL_W, y: TOP + row * ROW_H }));
    });
    const W = LEFT * 2 + lanes.length * COL_W;
    const H = TOP + maxRows * ROW_H + 10;
    const at = (sid, qid) => pos.get(qid + '|' + sid);
    const selNode = selected ? nodes.get(selected) : null;

    const edges = [];
    for (const n of list) {
      const to = at(n.sid, n.qid);
      for (const d of n.deps) {
        const from = at(n.sid, d);
        if (!from) continue;
        const dep = nodes.get(api.key(n.sid, d));
        const hot = selNode && (selNode.key === n.key || selNode.key === dep?.key);
        const off = n.disposed || dep?.disposed;
        let path;
        if (from.x === to.x) {
          // same lane: loop out on the right side
          const x = from.x + BOX_W, bend = x + 18 + Math.min(40, Math.abs(to.y - from.y) / 4);
          path = `M${x},${from.y + BOX_H / 2} C${bend},${from.y + BOX_H / 2} ${bend},${to.y + BOX_H / 2} ${x},${to.y + BOX_H / 2}`;
        } else {
          const [a, b] = from.x < to.x ? [from.x + BOX_W, to.x] : [from.x, to.x + BOX_W];
          const mid = (a + b) / 2;
          path = `M${a},${from.y + BOX_H / 2} C${mid},${from.y + BOX_H / 2} ${mid},${to.y + BOX_H / 2} ${b},${to.y + BOX_H / 2}`;
        }
        edges.push(`<path class="e${hot ? ' hot' : ''}${off ? ' off' : ''}" d="${path}" marker-end="url(#rxArrow)"/>`);
      }
    }

    const boxes = list.map((n) => {
      const p = at(n.sid, n.qid);
      const label = n.label ?? n.id;
      const text = label.length > 28 ? `${label.slice(0, 27)}…` : label;
      return `<g class="n${n.disposed ? ' off' : ''}${selected === n.key ? ' sel' : ''}" data-k="${esc(n.key)}" transform="translate(${p.x},${p.y})">
        <title>${esc(`${n.kind} ${n.qid}${n.label ? `\n${n.label}` : ''}`)}</title>
        <rect width="${BOX_W}" height="${BOX_H}" rx="4" fill="#0d1117" stroke="${KIND[n.kind].color}"/>
        <rect width="4" height="${BOX_H}" rx="2" fill="${KIND[n.kind].color}"/>
        <text x="10" y="15">${esc(text)}</text></g>`;
    }).join('');

    const laneHeads = lanes.map((l, col) => `<text class="lane" x="${LEFT + col * COL_W}" y="16">${esc(l)}</text>`).join('');
    const scroll = [graph.scrollLeft, graph.scrollTop];
    graph.innerHTML = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="rxArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,0 L8,4 L0,8 z" fill="#484f58"/></marker></defs>
      ${laneHeads}${edges.join('')}${boxes}</svg>`;
    [graph.scrollLeft, graph.scrollTop] = scroll;
  }

  const showDetail = () => {
    const n = selected ? nodes.get(selected) : null;
    const box = $('rxDetail');
    if (!n) { box.innerHTML = '<span class="muted">click a node for details</span>'; return; }
    const dependents = [...nodes.values()].filter((x) => x.sid === n.sid && x.deps.includes(n.qid));
    const ref = (qid) => {
      const x = nodes.get(api.key(n.sid, qid));
      return `<a href="#" class="wlink" data-k="${esc(api.key(n.sid, qid))}">${esc(x?.label ?? qid)}</a>${x?.disposed ? ' <span class="muted">(disposed)</span>' : ''}`;
    };
    box.innerHTML = `
      <div><b style="color:${KIND[n.kind].color}">${esc(n.kind)}</b> ${n.disposed ? '<span class="pill">disposed</span>' : '<span class="pill">live</span>'}</div>
      <table class="tkv" style="margin-top:6px"><tbody>
        <tr><td>label</td><td>${esc(n.label ?? '—')}</td></tr>
        <tr><td>id</td><td>${esc(n.qid)}</td></tr>
        <tr><td>lane</td><td>${esc(n.lane)}</td></tr>
        <tr><td>owner</td><td>${esc(n.owner ?? '—')}</td></tr>
        <tr><td>session</td><td>${esc(api.state.sessions.get(n.sid)?.name ?? n.sid)}</td></tr>
      </tbody></table>
      <h2 style="margin-top:10px">Depends on</h2>
      <div>${n.deps.length ? n.deps.map(ref).join('<br>') : '<span class="muted">nothing</span>'}</div>
      <h2 style="margin-top:10px">Dependents</h2>
      <div>${dependents.length ? dependents.map((x) => ref(x.qid)).join('<br>') : '<span class="muted">none</span>'}</div>`;
  };

  const select = (k) => {
    selected = selected === k ? null : k;
    drawn = -1;
    draw();
    showDetail();
  };
  $('rxGraph').addEventListener('click', (ev) => {
    const g = ev.target.closest('g.n');
    if (g) select(g.dataset.k);
  });
  $('rxDetail').addEventListener('click', (ev) => {
    const a = ev.target.closest('a[data-k]');
    if (!a) return;
    ev.preventDefault();
    if (nodes.has(a.dataset.k)) select(a.dataset.k);
  });

  let lastSel = null;
  api.onRender(() => {
    if (!section.classList.contains('on')) return;
    // selection scope (session picker) changes re-filter the lanes too
    const scope = api.state.sel;
    if (drawn === version && lastSel === scope) return;
    drawn = version;
    lastSel = scope;
    draw();
    if (selected && !nodes.has(selected)) selected = null;
    showDetail();
  });
}
