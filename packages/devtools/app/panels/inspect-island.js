// Island inspector tabs (rendered into #inspExtra): Elements (the island's
// real DOM via `island.tree`, hover-to-highlight in the page via
// `island.highlight`), Props (island:props history with diffs) and Events
// (island:event log with payload previews).
//
// Render contract: the inspector hook fires many times a second. The tab
// DOM is built once per inspected key; afterwards only counts/gates are
// touched, and lists re-render when their data changed. The tree is only
// rebuilt when a fetch lands, keeping expanded/selected state.

const CSS = `
.ii { margin: 10px 0 4px; }
.ii-tabs { display:flex; gap:4px; margin-bottom:8px; }
.ii-tabs button { background:none; border:1px solid #21262d; color:#8b949e; border-radius:6px; padding:3px 10px; cursor:pointer; font:inherit; font-size:11px; }
.ii-tabs button.on { color:#c9d1d9; border-color:#58a6ff; background:#161b22; }
.ii-tabs .n { color:#8b949e; margin-left:4px; }
.ii-pane { display:none; } .ii-pane.on { display:block; }
.ii-bar { display:flex; gap:8px; align-items:center; margin-bottom:6px; font-size:11px; flex-wrap:wrap; }
.ii-bar input[type=text] { background:#0d1117; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:2px 6px; font:inherit; }
.ii-msg { color:#d29922; font-size:11px; }
.ii-split { display:grid; grid-template-columns: minmax(0,3fr) minmax(0,2fr); gap:10px; }
.ii-tree, .ii-detail, .ii-list { border:1px solid #21262d; border-radius:8px; background:#010409; max-height:380px; overflow:auto; padding:4px 6px; font-size:11px; }
.ii-node > .ii-row { white-space:nowrap; cursor:default; padding:0 4px; border-radius:3px; }
.ii-node > .ii-row:hover { background:#161b22; }
.ii-node > .ii-row.sel { background:#1f6feb33; }
.ii-node > .ii-kids { padding-left:14px; }
.ii-node.closed > .ii-kids { display:none; }
.ii-caret { display:inline-block; width:12px; color:#8b949e; cursor:pointer; user-select:none; }
.ii-tag { color:#7ee787; } .ii-an { color:#79c0ff; } .ii-av { color:#a5d6ff; } .ii-tx { color:#c9d1d9; }
.ii-more { color:#8b949e; font-style:italic; padding-left:16px; }
.ii-entry { border-bottom:1px dashed #21262d; padding:4px 0; }
.ii-entry pre { margin:2px 0 0; white-space:pre-wrap; word-break:break-all; }
.ii-t { color:#484f58; margin-right:6px; }
.ii-add { color:#3fb950; } .ii-del { color:#f85149; } .ii-chg { color:#d29922; }
`;

const MAX_PROPS = 100;
const MAX_EVENTS = 500;

const injectCss = () => {
  if (document.getElementById('ii-css')) return;
  const s = document.createElement('style');
  s.id = 'ii-css';
  s.textContent = CSS;
  document.head.appendChild(s);
};

const clock = (t) => {
  const d = new Date(t);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

const tryJson = (s) => {
  try { return { ok: true, v: JSON.parse(s) }; } catch { return { ok: false }; }
};

/** Top-level key diff between two props previews ('' when unparseable). */
const diffProps = (prev, next, esc) => {
  if (prev === undefined) return '<span class="muted">initial</span>';
  const a = tryJson(prev), b = tryJson(next);
  if (!a.ok || !b.ok || typeof a.v !== 'object' || typeof b.v !== 'object' || !a.v || !b.v) {
    return prev === next ? '<span class="muted">unchanged</span>' : '<span class="ii-chg">changed (preview truncated)</span>';
  }
  const out = [];
  for (const k of Object.keys(b.v)) {
    if (!(k in a.v)) out.push(`<span class="ii-add">+ ${esc(k)}: ${esc(JSON.stringify(b.v[k]))}</span>`);
    else if (JSON.stringify(a.v[k]) !== JSON.stringify(b.v[k])) {
      out.push(`<span class="ii-chg">~ ${esc(k)}: ${esc(JSON.stringify(a.v[k]))} → ${esc(JSON.stringify(b.v[k]))}</span>`);
    }
  }
  for (const k of Object.keys(a.v)) if (!(k in b.v)) out.push(`<span class="ii-del">− ${esc(k)}</span>`);
  return out.length ? out.join('<br>') : '<span class="muted">unchanged</span>';
};

export function setup(api) {
  injectCss();
  const { esc } = api;

  /** islandKey → { props: [{t, preview}], events: [{t, name, payload}] } */
  const hist = new Map();
  const histOf = (k) => {
    let h = hist.get(k);
    if (!h) hist.set(k, (h = { props: [], events: [], seq: 0 }));
    return h;
  };

  api.onEvent((s, e) => {
    if (e.type === 'island:props') {
      const h = histOf(api.key(s.id, e.instance));
      h.props.push({ t: Date.now(), preview: e.props });
      if (h.props.length > MAX_PROPS) h.props.shift();
      h.seq++;
    } else if (e.type === 'island:event') {
      const h = histOf(api.key(s.id, e.instance));
      h.events.push({ t: Date.now(), name: e.name, payload: e.payload });
      if (h.events.length > MAX_EVENTS) h.events.shift();
      h.seq++;
    }
  });
  api.onReset(() => { hist.clear(); view = null; });
  api.onReconcile((ids) => {
    for (const k of [...hist.keys()]) if (!ids.has(api.sessOf(k))) hist.delete(k);
  });

  let tab = 'elements';
  /** Per-inspected-key UI state; rebuilt when the key changes. */
  let view = null;

  const target = (islandKey) => {
    const sid = api.sessOf(islandKey);
    const instance = islandKey.slice(sid.length + 1);
    // Nested islands' handles live in their worker: their DOM is replayed
    // into the top-level island's container, so the tree comes from there.
    const root = instance.split('~')[0];
    return { sid, instance, root, nested: root !== instance };
  };

  const blocked = (sid) => {
    if (api.livePaused) return 'Viewing a recording: live DOM is unavailable.';
    if (api.state.sessions.get(sid)?.closed) return 'Session has ended: the island DOM is gone.';
    if (!api.hasCommand(sid, 'island.tree')) {
      return "The app doesn't expose 'island.tree' (devtools was off when the island mounted, or an older @atolljs/islands).";
    }
    return null;
  };

  /* ── Elements ──────────────────────────────────────────────────────────── */

  const renderAttrs = (n) =>
    n.attrs.map(([k, v]) => ` <span class="ii-an">${esc(k)}</span>=<span class="ii-av">"${esc(v.length > 60 ? `${v.slice(0, 60)}…` : v)}"</span>`).join('');

  const nodeRow = (n) => {
    if (n.tag === '#text') return `<span class="ii-tx">"${esc(n.text.length > 80 ? `${n.text.slice(0, 80)}…` : n.text)}"</span>`;
    if (n.tag === '#shadow-root') return '<span class="muted">#shadow-root</span>';
    return `<span class="ii-tag">&lt;${esc(n.tag)}</span>${renderAttrs(n)}<span class="ii-tag">&gt;</span>`;
  };

  const buildTree = (v, root) => {
    const byId = new Map();
    const build = (n, depth) => {
      byId.set(n.id, n);
      const el = document.createElement('div');
      el.className = 'ii-node';
      el.dataset.id = n.id;
      const hasKids = n.children.length > 0 || n.more;
      const open = v.expanded.has(n.id) || (!v.touched.has(n.id) && depth < 3);
      if (hasKids && !open) el.classList.add('closed');
      el.innerHTML =
        `<div class="ii-row${v.selected === n.id ? ' sel' : ''}" data-id="${esc(n.id)}">` +
        `<span class="ii-caret">${hasKids ? (open ? '▾' : '▸') : ''}</span>${nodeRow(n)}</div>`;
      if (hasKids) {
        const kids = document.createElement('div');
        kids.className = 'ii-kids';
        for (const c of n.children) kids.appendChild(build(c, depth + 1));
        if (n.more) kids.insertAdjacentHTML('beforeend', `<div class="ii-more">… ${n.more} more (node cap)</div>`);
        el.appendChild(kids);
      }
      return el;
    };
    v.byId = byId;
    const scroll = v.els.tree.scrollTop;
    v.els.tree.replaceChildren(build(root, 0));
    v.els.tree.scrollTop = scroll;
  };

  const showDetail = (v) => {
    const n = v.byId?.get(v.selected);
    if (!n) { v.els.detail.innerHTML = '<span class="muted">click a node for its attributes</span>'; return; }
    v.els.detail.innerHTML =
      `<div><b>${esc(n.tag)}</b> <span class="muted">${esc(n.id)}</span></div>` +
      (n.attrs.length
        ? `<table class="tkv" style="margin-top:4px"><tbody>${n.attrs.map(([k, val]) => `<tr><td>${esc(k)}</td><td style="word-break:break-all">${esc(val)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="muted" style="margin-top:4px">no attributes</div>') +
      (n.text !== undefined ? `<pre class="body" style="margin-top:6px">${esc(n.text)}</pre>` : '') +
      `<div class="muted" style="margin-top:6px">${n.children.length} child node(s)${n.more ? ` + ${n.more} omitted` : ''}</div>`;
  };

  const fetchTree = (v) => {
    const t = target(v.key);
    if (blocked(t.sid) || v.loading) return;
    v.loading = true;
    v.els.status.textContent = 'loading…';
    api.control(t.sid, 'island.tree', { instance: t.root, maxNodes: 4000 }, 5000)
      .then((res) => {
        if (view !== v) return;
        buildTree(v, res.root);
        showDetail(v);
        v.loaded = true;
        v.els.status.textContent = `${res.count} nodes${res.truncated ? ' (capped)' : ''} · ${clock(Date.now())}`;
      })
      .catch((err) => { if (view === v) v.els.status.textContent = `error: ${err.message}`; })
      .finally(() => { v.loading = false; });
  };

  const highlight = (v, id) => {
    if (v.hoverId === id) return;
    v.hoverId = id;
    const t = target(v.key);
    if (blocked(t.sid)) return;
    api.control(t.sid, 'island.highlight', { instance: t.root, id }, 2000).catch(() => {});
  };

  /* ── build per key ─────────────────────────────────────────────────────── */

  const build = (extra, islandKey) => {
    let box = extra.querySelector(':scope > .ii');
    if (!box) {
      box = document.createElement('div');
      box.className = 'ii';
      extra.appendChild(box);
    }
    box.innerHTML = `
      <div class="ii-tabs">
        <button data-tab="elements">Elements</button>
        <button data-tab="props">Props<span class="n" data-n="props"></span></button>
        <button data-tab="events">Events<span class="n" data-n="events"></span></button>
      </div>
      <div class="ii-pane" data-pane="elements">
        <div class="ii-bar">
          <button class="act" data-act="refresh">Refresh</button>
          <label><input type="checkbox" data-act="auto"> auto-refresh (2s)</label>
          <span class="muted" data-el="status"></span>
        </div>
        <div class="ii-msg" data-el="msg"></div>
        <div class="ii-split">
          <div class="ii-tree" data-el="tree"><span class="muted">no tree loaded</span></div>
          <div class="ii-detail" data-el="detail"><span class="muted">click a node for its attributes</span></div>
        </div>
      </div>
      <div class="ii-pane" data-pane="props"><div class="ii-list" data-el="props"></div></div>
      <div class="ii-pane" data-pane="events">
        <div class="ii-bar"><input type="text" data-el="filter" placeholder="filter by event name"></div>
        <div class="ii-list" data-el="events"></div>
      </div>`;
    const q = (sel) => box.querySelector(sel);
    const v = {
      key: islandKey, box, expanded: new Set(), touched: new Set(), selected: null, byId: null,
      hoverId: undefined, loaded: false, loading: false, tried: false, auto: false, lastAuto: 0,
      propsSeq: -1, eventsSeq: -1, filter: '', gate: undefined,
      els: {
        tree: q('[data-el=tree]'), detail: q('[data-el=detail]'), status: q('[data-el=status]'),
        msg: q('[data-el=msg]'), props: q('[data-el=props]'), events: q('[data-el=events]'),
        filter: q('[data-el=filter]'), refresh: q('[data-act=refresh]'), auto: q('[data-act=auto]'),
        nProps: q('[data-n=props]'), nEvents: q('[data-n=events]'),
      },
    };
    const setTab = (name) => {
      tab = name;
      for (const b of box.querySelectorAll('.ii-tabs button')) b.classList.toggle('on', b.dataset.tab === name);
      for (const p of box.querySelectorAll('.ii-pane')) p.classList.toggle('on', p.dataset.pane === name);
    };
    setTab(tab);
    q('.ii-tabs').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-tab]');
      if (b) setTab(b.dataset.tab);
    });
    v.els.refresh.onclick = () => fetchTree(v);
    v.els.auto.onchange = () => { v.auto = v.els.auto.checked; };
    v.els.filter.oninput = () => { v.filter = v.els.filter.value.trim().toLowerCase(); v.eventsSeq = -1; renderLists(v, true); };
    v.els.tree.addEventListener('click', (ev) => {
      const row = ev.target.closest('.ii-row');
      if (!row) return;
      const node = row.parentElement;
      const id = row.dataset.id;
      if (ev.target.classList.contains('ii-caret') && node.querySelector(':scope > .ii-kids')) {
        const closed = node.classList.toggle('closed');
        v.touched.add(id);
        if (closed) v.expanded.delete(id); else v.expanded.add(id);
        ev.target.textContent = closed ? '▸' : '▾';
        return;
      }
      v.els.tree.querySelector('.ii-row.sel')?.classList.remove('sel');
      row.classList.add('sel');
      v.selected = id;
      showDetail(v);
    });
    v.els.tree.addEventListener('mouseover', (ev) => {
      const row = ev.target.closest('.ii-row');
      if (row) highlight(v, row.dataset.id);
    });
    v.els.tree.addEventListener('mouseleave', () => highlight(v, null));
    return v;
  };

  /* ── lists ─────────────────────────────────────────────────────────────── */

  const renderLists = (v, force = false) => {
    const h = hist.get(v.key) ?? { props: [], events: [] };
    v.els.nProps.textContent = h.props.length ? String(h.props.length) : '';
    v.els.nEvents.textContent = h.events.length ? String(h.events.length) : '';
    if (force || v.propsSeq !== h.props.length + (h.props.at(-1)?.t ?? 0)) {
      v.propsSeq = h.props.length + (h.props.at(-1)?.t ?? 0);
      const rows = [];
      for (let i = h.props.length - 1; i >= 0 && rows.length < 50; i--) {
        const p = h.props[i];
        const parsed = tryJson(p.preview);
        rows.push(
          `<div class="ii-entry"><span class="ii-t">${clock(p.t)}</span>${i === 0 && h.props.length < MAX_PROPS ? '<span class="pill">mount</span>' : ''}` +
          `<div style="margin-top:2px">${diffProps(h.props[i - 1]?.preview, p.preview, esc)}</div>` +
          `<details><summary class="muted">props</summary><pre>${esc(parsed.ok ? JSON.stringify(parsed.v, null, 2) : p.preview)}</pre></details></div>`,
        );
      }
      v.els.props.innerHTML = rows.join('') || '<span class="muted">no island:props yet (emitted on mount and every updateProps while devtools is on)</span>';
    }
    const evSeq = h.events.length + (h.events.at(-1)?.t ?? 0);
    if (force || v.eventsSeq !== evSeq) {
      v.eventsSeq = evSeq;
      const rows = [];
      for (let i = h.events.length - 1; i >= 0 && rows.length < 200; i--) {
        const e = h.events[i];
        if (v.filter && !e.name.toLowerCase().includes(v.filter)) continue;
        rows.push(
          `<div class="ii-entry"><span class="ii-t">${clock(e.t)}</span><b>${esc(e.name)}</b>` +
          (e.payload !== undefined ? `<pre>${esc(e.payload)}</pre>` : '') + '</div>',
        );
      }
      v.els.events.innerHTML = rows.join('') || `<span class="muted">${h.events.length ? 'no events match the filter' : 'no emits yet'}</span>`;
    }
  };

  /* ── hook ──────────────────────────────────────────────────────────────── */

  api.onInspectIsland((islandKey, island, { extra }) => {
    if (!view || view.key !== islandKey || !view.box.isConnected) {
      if (view) highlight(view, null);
      view = build(extra, islandKey);
    }
    const v = view;
    const t = target(islandKey);
    const reason = blocked(t.sid);
    const msg = reason ?? (t.nested
      ? `Nested island: its handle lives in the parent worker, so the tree below is the top-level island ${t.root}, which contains this island's replayed DOM.`
      : '');
    if (v.gate !== msg) {
      v.gate = msg;
      v.els.msg.textContent = msg;
      v.els.refresh.disabled = reason !== null;
      v.els.auto.disabled = reason !== null;
    }
    if (!reason && !v.tried) {
      v.tried = true;
      fetchTree(v);
    }
    if (!reason && v.auto && Date.now() - v.lastAuto > 2000) {
      v.lastAuto = Date.now();
      fetchTree(v);
    }
    renderLists(v);
  });
}
