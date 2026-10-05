// Dashboard shell: command palette, keyboard shortcuts + help overlay,
// hash routing (deep links, back/forward, last view per context), the
// responsive nav ("More" overflow menu), collapsible session sidebar,
// scrollable tables, view intros, wait-for-app banner, first-run tip.
//
// Loads last (PANELS in main.js) so every panel's views, subviews and
// palette items exist; still reads views/subviews from the DOM at use
// time, so anything added later shows up too. Never assumes a top-level
// window: the same app runs in the overlay iframe, a tab, and the Chrome
// DevTools extension panel (`body.ext`, packages/devtools-extension).

import {
  formatRoute, groupResults, isTypingTarget, keyTail, layoutNav, letterForView,
  parseRoute, rankItems, resolveKey, viewForLetter,
} from './route.js';

const LS = 'atoll-devtools:';
const store = {
  get(k, d) {
    try { const v = localStorage.getItem(LS + k); return v === null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch { /* storage off (sandboxed frame) */ }
  },
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MOD = isMac ? '⌘' : 'Ctrl';
const inFrame = (() => { try { return window.parent !== window; } catch { return true; } })();

/** What each core view shows and what populates it (checked against src/). */
const CORE_INTROS = {
  dashboard:
    'The app map plus pool, worker and island tables, built from <code>pool:init</code>, ' +
    '<code>worker:spawn</code> and <code>island:mount</code>. Click a node or row to open its inspector. ' +
    'Workers only report if <code>initDevtools()</code> ran before their pool spawned.',
  tasks:
    'Every pool task call: queue wait and run time per worker slot, with per-task aggregates. ' +
    'Fills as the app calls methods on a <code>connectWorker</code> client.',
  network:
    'Per-second channel traffic (tasks, island ops, fetches) and a log of real <code>fetch()</code> calls ' +
    'from the main thread and workers. XHR is not captured; <code>connectDevtools({ network: false })</code> turns the probe off.',
  memory:
    'Shared-memory writes need a <code>defineSharedMemory</code> contract passed to <code>connectWorker</code> as ' +
    '<code>sharedMemory</code>. JS heap is sampled every few seconds (Chrome <code>measureUserAgentSpecificMemory</code> / ' +
    '<code>performance.memory</code>, Node <code>process.memoryUsage()</code>).',
  log: 'The raw event stream, one line per event as it arrives.',
};

const GROUP_ORDER = ['Views', 'Subviews', 'Commands', 'Sessions', 'Islands', 'Workers', 'Pools'];

const textOf = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent ?? '';
};

export function setup(api) {
  const { state, esc } = api;
  // DevTools extension panel: also an iframe, but owned by DevTools rather
  // than a host app, so it keeps real history and skips the overlay's
  // parent messaging. Ctrl/Cmd+Shift+K opens the palette there as well.
  const ext = document.body.classList.contains('ext');
  const embedded = inFrame && !ext;
  const PAL_KEYS = ext ? [MOD, 'Shift', 'K'] : [MOD, 'K'];
  const ctx = api.isMini ? 'mini' : ext ? 'ext' : 'full';
  const local = () => document.body.classList.contains('local');
  const navEl = document.querySelector('.panels > nav');

  /* ── DOM readers (live: panels may add views/subviews any time) ─────── */

  const viewButtons = () => [...navEl.querySelectorAll('button[data-view]')];
  const labelOf = (b) =>
    [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() ||
    b.dataset.view || b.dataset.sub || '';
  const views = () => viewButtons().map((b) => ({ id: b.dataset.view, label: labelOf(b), btn: b }));
  const viewExists = (id) => !!document.getElementById(`view-${id}`) && viewButtons().some((b) => b.dataset.view === id);
  const activeView = () => navEl.querySelector('button[data-view].on')?.dataset.view ?? null;
  const subnavOf = (id) => document.getElementById(`view-${id}`)?.querySelector(':scope > .subnav') ?? null;
  const subButtons = (id) => [...(subnavOf(id)?.querySelectorAll('button[data-sub]') ?? [])];
  const visible = (b) => b.style.display !== 'none' && !b.hidden;
  const activeSub = (id) => subnavOf(id)?.querySelector('button[data-sub].on')?.dataset.sub ?? null;
  // Default sub = the first one (mini: the Map tab). A route omits it.
  const firstSub = (id) => subButtons(id).find(visible)?.dataset.sub ?? null;
  const viewLabel = (id) => views().find((v) => v.id === id)?.label ?? id;

  /* ── routing ─────────────────────────────────────────────────────────── */

  let suppress = 0;   // >0 while applying a route: don't write one back
  let pending = null; // { session?, island?, worker? } waiting for data
  let lastNavKey = '';
  let lastHash = null;
  let syncQueued = false;

  const isLiveSess = (sid) => state.sessions.get(sid)?.closed !== true;

  function currentRoute() {
    const view = activeView();
    if (!view) return null;
    const sub = activeSub(view);
    const params = {};
    if (state.sel && !local()) params.session = state.sel;
    if (view === 'dashboard' && sub === 'tv-island' && state.inspect) params.island = state.inspect;
    if (view === 'dashboard' && sub === 'tv-worker' && state.inspectWorker) params.worker = state.inspectWorker;
    return { view, sub: sub && sub !== firstSub(view) ? sub : null, params };
  }

  function writeRoute() {
    syncQueued = false;
    if (suppress || pending) return;
    const r = currentRoute();
    if (!r) return;
    const h = formatRoute(r);
    const navKey = `${r.view}/${r.sub ?? ''}/${r.params.island ?? ''}/${r.params.worker ?? ''}`;
    if (h === lastHash && h === location.hash) { lastNavKey = navKey; return; } // every render: stay cheap
    lastHash = h;
    if (h !== location.hash) {
      // The flyout is an iframe: pushState there would add entries to the
      // HOST page's joint history (its Back button would flip devtools tabs).
      const push = !embedded && navKey !== lastNavKey && lastNavKey !== '';
      try { history[push ? 'pushState' : 'replaceState'](null, '', h); } catch { /* sandboxed */ }
    }
    lastNavKey = navKey;
    store.set(`last:${ctx}`, formatRoute({ view: r.view, sub: r.sub }));
    if (embedded) {
      try { window.parent.postMessage({ type: 'atoll-devtools:route', hash: h }, '*'); } catch { /* detached */ }
    }
  }
  const scheduleWrite = () => {
    if (syncQueued || suppress) return;
    syncQueued = true;
    queueMicrotask(writeRoute);
  };

  function applyRoute(r) {
    if (!r || !viewExists(r.view)) return false;
    suppress++;
    try {
      pending = null;
      const p = r.params ?? {};
      const want = {};
      if (!local()) {
        if (p.session && state.sessions.has(p.session)) state.sel = p.session;
        else if (p.session) want.session = p.session;
        else state.sel = null;
      }
      if (r.view === 'dashboard' && r.sub === 'tv-island' && p.island) want.island = p.island;
      else if (r.view === 'dashboard' && r.sub === 'tv-worker' && p.worker) want.worker = p.worker;
      const sub = r.sub && subButtons(r.view).some((b) => b.dataset.sub === r.sub) ? r.sub : firstSub(r.view);
      if (want.island || want.worker) api.openView(r.view);
      else if (sub) api.openSub(r.view, sub);
      else api.openView(r.view);
      if (Object.keys(want).length) pending = want;
    } finally {
      suppress--;
    }
    tryPending();
    lastNavKey = '';
    if (!pending) writeRoute();
    return true;
  }

  /** Apply routed selections once their session / island / worker shows up. */
  function tryPending() {
    if (!pending || suppress) return;
    const p = pending;
    if (p.session && state.sessions.has(p.session)) {
      state.sel = p.session;
      delete p.session;
      api.scheduleRender();
    }
    let open = null;
    if (p.island) {
      const k = resolveKey(state.islands.keys(), p.island, (x) => isLiveSess(x.split('|')[0]) && !state.islands.get(x)?.ended);
      if (k) { delete p.island; state.inspect = k; open = 'tv-island'; }
    }
    if (p.worker) {
      const k = resolveKey(state.workers.keys(), p.worker, (x) => isLiveSess(x.split('|')[0]) && !state.workers.get(x)?.dead);
      if (k) { delete p.worker; state.inspectWorker = k; open = 'tv-worker'; }
    }
    if (!Object.keys(p).length) pending = null;
    if (open) {
      suppress++;
      try { api.openSub('dashboard', open); } finally { suppress--; }
    }
    if (!pending) scheduleWrite();
  }

  const applyHash = () => {
    // popstate + hashchange both fire on one traversal; the 2nd is a no-op
    const cur = currentRoute();
    if (!pending && cur && location.hash === formatRoute(cur)) return;
    const r = parseRoute(location.hash);
    if (r) applyRoute(r);
  };
  window.addEventListener('popstate', applyHash);
  window.addEventListener('hashchange', applyHash);

  api.onNavigate(() => {
    if (suppress) return;
    pending = null; // the user went somewhere else: drop a stale deep link
    scheduleWrite();
    scheduleNavLayout();
  });
  api.onRender(() => {
    if (pending) tryPending();
    else if (!suppress) scheduleWrite(); // selection / inspector changes → replaceState
  });

  /* ── responsive nav: fold overflowing tabs into "More ▾" ───────────── */

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'sh-more';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.title = 'More views';
  more.innerHTML = 'More ▾<span class="nbadge"></span>';
  more.style.display = 'none';
  navEl.append(more);

  let navSig = '';
  let navRaf = 0;
  function layoutNavNow() {
    navRaf = 0;
    if (navEl.lastElementChild !== more) navEl.append(more); // addView appends after it
    const btns = viewButtons();
    const sig = `${navEl.clientWidth}|${btns.map((b) => `${b.dataset.view}:${b.querySelector('.nbadge')?.textContent ?? ''}:${b.classList.contains('on') ? 1 : 0}`).join(',')}`;
    if (sig === navSig) return;
    navSig = sig;
    btns.forEach((b) => b.classList.remove('sh-ovf'));
    more.style.display = '';
    const avail = navEl.clientWidth;
    if (!avail) { more.style.display = 'none'; return; } // hidden frame: measure later
    const widths = btns.map((b) => b.getBoundingClientRect().width);
    const moreW = more.getBoundingClientRect().width + 4;
    const active = btns.findIndex((b) => b.classList.contains('on'));
    const hidden = layoutNav(widths, avail, active, moreW);
    for (const i of hidden) btns[i].classList.add('sh-ovf');
    more.style.display = hidden.length ? '' : 'none';
    updateMoreBadge();
  }
  function scheduleNavLayout() {
    if (!navRaf) navRaf = requestAnimationFrame(layoutNavNow);
  }
  function updateMoreBadge() {
    let sum = 0;
    let flag = false;
    for (const b of navEl.querySelectorAll('button.sh-ovf')) {
      const t = b.querySelector('.nbadge')?.textContent ?? '';
      if (!t) continue;
      const n = Number(t);
      if (Number.isFinite(n)) sum += n; else flag = true;
    }
    more.querySelector('.nbadge').textContent = flag ? '!' : sum ? String(sum) : '';
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleNavLayout).observe(navEl);
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(scheduleNavLayout).observe(navEl, { childList: true, subtree: true, characterData: true });
  }
  scheduleNavLayout();

  let menu = null;
  const closeMenu = (focusBack = false) => {
    if (!menu) return;
    menu.remove();
    menu = null;
    more.setAttribute('aria-expanded', 'false');
    if (focusBack) more.focus();
  };
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) return closeMenu();
    menu = document.createElement('div');
    menu.className = 'sh-menu';
    menu.setAttribute('role', 'menu');
    for (const b of navEl.querySelectorAll('button.sh-ovf')) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      if (b.classList.contains('on')) item.className = 'on';
      const badge = b.querySelector('.nbadge')?.textContent ?? '';
      item.innerHTML = `<span>${esc(labelOf(b))}</span><span class="nbadge">${esc(badge)}</span>`;
      if (b.title) item.title = b.title;
      item.onclick = () => { closeMenu(); api.openView(b.dataset.view); };
      menu.append(item);
    }
    document.body.append(menu);
    const r = more.getBoundingClientRect();
    const w = menu.getBoundingClientRect().width;
    menu.style.top = `${Math.round(r.bottom + 2)}px`;
    menu.style.left = `${Math.max(4, Math.min(r.right - w, innerWidth - w - 4))}px`;
    more.setAttribute('aria-expanded', 'true');
    menu.addEventListener('keydown', (ev) => {
      const items = [...menu.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      else if (ev.key === 'Tab') closeMenu();
    });
    menu.querySelector('button')?.focus();
  });
  document.addEventListener('click', (e) => {
    if (menu && !menu.contains(e.target)) closeMenu();
  });

  /* ── collapsible session sidebar (aggregate, full page only) ────────── */

  const sideBtn = document.getElementById('sideToggle');
  const setSide = (open) => {
    document.body.classList.toggle('noside', !open);
    sideBtn?.setAttribute('aria-expanded', String(open));
    store.set('sidebar', open);
    scheduleNavLayout();
  };
  setSide(store.get('sidebar', true));
  if (sideBtn) sideBtn.onclick = () => setSide(document.body.classList.contains('noside'));
  const sidebarApplies = () => !local() && !api.isMini;

  /* ── tables scroll sideways instead of stretching the layout ───────── */

  const wrapTable = (t) => {
    const p = t.parentElement;
    if (!p || p.classList.contains('sh-tscroll') || t.closest('.sh-help')) return;
    const w = document.createElement('div');
    w.className = 'sh-tscroll';
    p.insertBefore(w, t);
    w.append(t);
  };
  const panelsEl = document.querySelector('.panels');
  panelsEl.querySelectorAll('table').forEach(wrapTable);
  if (typeof MutationObserver !== 'undefined') {
    // Panels may build tables later; skip row churn (tbody innerHTML) cheaply.
    new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          const tag = n.nodeName;
          if (tag === 'TR' || tag === 'TD' || tag === 'TBODY' || tag === 'THEAD' || tag === 'TH') continue;
          if (tag === 'TABLE') wrapTable(n);
          else if (n.firstElementChild) n.querySelectorAll('table').forEach(wrapTable);
        }
      }
    }).observe(panelsEl, { childList: true, subtree: true });
  }

  /* ── view intros + wait-for-app banner ─────────────────────────────── */

  const dismissed = new Set(store.get('intros-dismissed', []));
  const introEls = new Map();
  function placeIntro(id) {
    const section = document.getElementById(`view-${id}`);
    const html = api.viewIntros.get(id);
    let el = introEls.get(id);
    if (!section || !html || dismissed.has(id)) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'sh-intro';
      el.dataset.intro = id;
      introEls.set(id, el);
    }
    el.innerHTML = `<span>${html}</span><button type="button" class="sh-x" title="Dismiss" aria-label="Dismiss this intro">×</button>`;
    el.querySelector('button').onclick = () => {
      dismissed.add(id);
      store.set('intros-dismissed', [...dismissed]);
      el.remove();
    };
    if (el.parentElement !== section || section.firstElementChild !== el) section.prepend(el);
  }
  (api.hooks.intro ??= []).push((id) => placeIntro(id));
  for (const [id, html] of Object.entries(CORE_INTROS)) {
    if (!api.viewIntros.has(id)) api.viewIntros.set(id, html);
  }
  for (const id of api.viewIntros.keys()) placeIntro(id);

  const wait = document.createElement('div');
  wait.className = 'sh-wait';
  wait.setAttribute('role', 'status');
  wait.innerHTML = api.transport === 'broadcast'
    ? '<span>Waiting for an app on this origin. Open it with <code>?__atoll_devtools</code> in the URL ' +
      '(<code>initDevtools()</code>), or call <code>connectDevtools()</code>, before its pools spawn.</span>'
    : api.transport === 'extension'
    ? '<span>No atoll session on the inspected page. Open it with <code>?__atoll_devtools</code> in the URL ' +
      '(<code>initDevtools()</code>), or call <code>connectDevtools()</code>, before its pools spawn: this panel ' +
      'picks it up on its own. <a href="https://jwhenry3.github.io/atolljs/consumer/devtools/" target="_blank" ' +
      'rel="noopener">Devtools docs</a></span>'
    : '<span>No sessions yet. Browser apps connect with <code>connectDevtools({ url })</code> pointed at this server; ' +
      'Node apps run with <code>ATOLL_DEVTOOLS=1</code> and <code>initDevtools()</code> from <code>@atolljs/devtools/node</code>.</span>';
  wait.hidden = true;
  wait.style.display = 'none';
  navEl.after(wait);
  const shownAt = performance.now();

  const updateWait = () => {
    // replay usually lands within a few hundred ms: don't flash the banner
    const none = state.sessions.size === 0 && performance.now() - shownAt > 1500;
    if (wait.style.display !== (none ? '' : 'none')) wait.style.display = none ? '' : 'none';
  };
  api.onRender(() => {
    // intros a panel re-rendered away (section.innerHTML) come back
    for (const [id, el] of introEls) if (!el.isConnected && !dismissed.has(id)) placeIntro(id);
    updateWait();
  });
  api.onTick(updateWait);

  /* ── command palette ───────────────────────────────────────────────── */

  const gKeys = (id) => {
    const l = letterForView(id, views());
    return l ? ['g', l] : null;
  };

  function collectItems() {
    const items = [];
    for (const v of views()) {
      items.push({
        id: `view:${v.id}`, group: 'Views', title: v.label,
        hint: textOf(api.viewIntros.get(v.id) ?? v.btn.title ?? ''),
        keys: gKeys(v.id), run: () => api.openView(v.id),
      });
    }
    for (const v of views()) {
      for (const b of subButtons(v.id)) {
        if (!visible(b)) continue;
        items.push({
          id: `sub:${v.id}/${b.dataset.sub}`, group: 'Subviews', title: `${v.label} › ${labelOf(b)}`,
          run: () => api.openSub(v.id, b.dataset.sub),
        });
      }
    }
    for (const p of api.palette) {
      if (p.when && !p.when()) continue;
      items.push({ ...p, group: p.group ?? 'Commands' });
    }
    const sessName = (sid) => state.sessions.get(sid)?.name ?? sid;
    if (!local() && state.sessions.size) {
      if (state.sel) {
        items.push({ id: 'sess:*', group: 'Sessions', title: 'All live sessions', run: () => { state.sel = null; api.render(); } });
      }
      for (const s of state.sessions.values()) {
        items.push({
          id: `sess:${s.id}`, group: 'Sessions', title: s.name ?? s.id,
          hint: `${s.runtime ?? ''}${s.closed ? ' · ended' : ''}${state.sel === s.id ? ' · selected' : ''}`,
          run: () => { state.sel = s.id; api.render(); },
        });
      }
    }
    const multi = state.sessions.size > 1;
    const live = (k, dead) => (isLiveSess(k.split('|')[0]) && !dead ? 0 : 1);
    const byLive = (arr) => arr.sort((a, b) => a[2] - b[2]).slice(0, 300);
    for (const [k, i] of byLive([...state.islands].map(([k, i]) => [k, i, live(k, i.ended)]))) {
      items.push({
        id: `island:${k}`, group: 'Islands', title: keyTail(k),
        hint: [i.app, i.fw, multi ? sessName(k.split('|')[0]) : '', i.ended ? 'unmounted' : ''].filter(Boolean).join(' · '),
        run: () => { state.inspect = k; api.openSub('dashboard', 'tv-island'); },
      });
    }
    for (const [k, w] of byLive([...state.workers].map(([k, w]) => [k, w, live(k, w.dead)]))) {
      const [, poolId, slot] = k.split('|');
      items.push({
        id: `worker:${k}`, group: 'Workers', title: `${poolId}#${slot}`,
        hint: [`${w.tasks} tasks`, multi ? sessName(k.split('|')[0]) : '', w.dead ? 'down' : ''].filter(Boolean).join(' · '),
        run: () => { state.inspectWorker = k; api.openSub('dashboard', 'tv-worker'); },
      });
    }
    for (const [k, p] of state.pools) {
      items.push({
        id: `pool:${k}`, group: 'Pools', title: p.label ?? p.poolId,
        hint: [p.dedicated ? 'dedicated worker' : `${p.size ?? '?'} workers`, multi ? sessName(k.split('|')[0]) : ''].filter(Boolean).join(' · '),
        run: () => {
          if (!local()) state.sel = k.split('|')[0];
          api.openSub('dashboard', 'tv-pools');
        },
      });
    }
    return items;
  }

  const pal = document.createElement('div');
  pal.className = 'sh-modal';
  pal.hidden = true;
  pal.innerHTML =
    '<div class="sh-card" role="dialog" aria-modal="true" aria-label="Command palette">' +
    '<input type="text" role="combobox" aria-expanded="true" aria-controls="sh-list" aria-autocomplete="list" ' +
    'placeholder="Jump to a view, island, worker, pool or command…" spellcheck="false" autocomplete="off">' +
    '<div class="sh-list" id="sh-list" role="listbox"></div>' +
    '<div class="sh-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span>' +
    '<span><kbd>Esc</kbd> close</span><span><kbd>?</kbd> all shortcuts</span></div></div>';
  document.body.append(pal);
  const palInput = pal.querySelector('input');
  const palList = pal.querySelector('.sh-list');
  let palItems = [];
  let flat = [];
  let sel = 0;
  let returnFocus = null;

  const hl = (title, idx) => {
    if (!idx.length) return esc(title);
    const on = new Set(idx);
    let out = '';
    for (let i = 0; i < title.length; i++) out += on.has(i) ? `<mark>${esc(title[i])}</mark>` : esc(title[i]);
    return out;
  };
  const kbdHtml = (keys) => (keys ? (Array.isArray(keys) ? keys : [keys]).map((k) => `<kbd>${esc(k)}</kbd>`).join('') : '');

  function renderPalette() {
    const q = palInput.value;
    const ranked = rankItems(q, palItems);
    // panel-registered groups (e.g. a recorder's) sit right after Commands
    const custom = [...new Set(palItems.map((i) => i.group))].filter((g) => !GROUP_ORDER.includes(g));
    const at = GROUP_ORDER.indexOf('Commands') + 1;
    const order = [...GROUP_ORDER.slice(0, at), ...custom, ...GROUP_ORDER.slice(at)];
    const groups = groupResults(ranked, { order, perGroup: q.trim() ? 12 : 8, byScore: !!q.trim() });
    flat = groups.flatMap((g) => g.items);
    sel = Math.min(sel, Math.max(0, flat.length - 1));
    if (!flat.length) {
      palList.innerHTML = `<div class="sh-none">No match for “${esc(q)}”</div>`;
      palInput.removeAttribute('aria-activedescendant');
      return;
    }
    let n = 0;
    palList.innerHTML = groups.map((g) =>
      `<div class="sh-grp" role="presentation">${esc(g.group)}</div>` +
      g.items.map((r) => {
        const i = n++;
        return `<div class="sh-item${i === sel ? ' on' : ''}" role="option" id="sh-opt-${i}" data-i="${i}" aria-selected="${i === sel}">` +
          `<span class="t">${hl(String(r.item.title ?? ''), r.idx)}</span>` +
          `<span class="h">${esc(r.item.hint ?? '')}</span>${kbdHtml(r.item.keys)}</div>`;
      }).join('')).join('');
    palInput.setAttribute('aria-activedescendant', `sh-opt-${sel}`);
  }
  function moveSel(d) {
    if (!flat.length) return;
    sel = (sel + d + flat.length) % flat.length;
    for (const el of palList.querySelectorAll('.sh-item')) {
      const on = Number(el.dataset.i) === sel;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', String(on));
      if (on) el.scrollIntoView({ block: 'nearest' });
    }
    palInput.setAttribute('aria-activedescendant', `sh-opt-${sel}`);
  }
  function runSel(i = sel) {
    const r = flat[i];
    if (!r) return;
    closePalette(false);
    try { r.item.run?.(); } catch (err) { api.toast(err, 'error'); }
  }
  function openPalette(prefill = '') {
    closeAll();
    returnFocus = document.activeElement;
    palItems = collectItems();
    palInput.value = prefill;
    sel = 0;
    pal.hidden = false;
    renderPalette();
    palInput.focus();
  }
  function closePalette(restore = true) {
    if (pal.hidden) return;
    pal.hidden = true;
    if (restore && returnFocus?.isConnected) returnFocus.focus();
  }
  palInput.addEventListener('input', () => { sel = 0; renderPalette(); });
  palInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) { e.preventDefault(); moveSel(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); moveSel(Math.min(8, flat.length - 1 - sel) || 0); }
    else if (e.key === 'PageUp') { e.preventDefault(); moveSel(-Math.min(8, sel)); }
    else if (e.key === 'Enter') { e.preventDefault(); runSel(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
    else if (e.key === 'Tab') { e.preventDefault(); moveSel(e.shiftKey ? -1 : 1); }
  });
  palList.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.sh-item');
    if (el && Number(el.dataset.i) !== sel) moveSel(Number(el.dataset.i) - sel);
  });
  palList.addEventListener('click', (e) => {
    const el = e.target.closest('.sh-item');
    if (el) runSel(Number(el.dataset.i));
  });
  pal.addEventListener('mousedown', (e) => { if (e.target === pal) closePalette(); });

  /* ── help overlay ──────────────────────────────────────────────────── */

  const help = document.createElement('div');
  help.className = 'sh-modal';
  help.hidden = true;
  document.body.append(help);

  function openHelp() {
    closeAll();
    returnFocus = document.activeElement;
    const vs = views();
    const rows = (list) => list.map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`).join('');
    const keys = [
      [PAL_KEYS.map((k) => `<kbd>${k}</kbd>`).join(' '), 'Command palette: views, subviews, islands, workers, pools, commands'],
      ['<kbd>?</kbd>', 'This help'],
      ['<kbd>g</kbd> then a letter', 'Go to a view (letters listed under Views)'],
      ['<kbd>[</kbd> <kbd>]</kbd>', 'Previous / next sub-tab of the current view'],
      ['<kbd>/</kbd>', 'Focus the current view’s search or filter box'],
      ['<kbd>Esc</kbd>', 'Close the palette, this help, or a menu'],
    ];
    if (api.isMini) keys.push(['<kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>D</kbd>', 'Show / hide the flyout (also works from the app page)']);
    if (sidebarApplies()) keys.push(['<kbd>s</kbd>', 'Show / hide the sessions sidebar']);
    const viewRows = vs.map((v) => {
      const l = letterForView(v.id, vs);
      const about = textOf(api.viewIntros.get(v.id) ?? '') || v.btn.title || '';
      return `<tr><td>${l ? `<kbd>g</kbd> <kbd>${esc(l)}</kbd>` : ''}</td><td><b>${esc(v.label)}</b>` +
        `${about ? `<div class="about">${esc(about)}</div>` : ''}</td></tr>`;
    }).join('');
    const cmds = api.palette.filter((p) => !p.when || p.when());
    help.innerHTML =
      '<div class="sh-card wide" role="dialog" aria-modal="true" aria-labelledby="sh-help-t">' +
      '<div class="sh-head"><span id="sh-help-t">Shortcuts &amp; views</span>' +
      '<button type="button" class="sh-x" aria-label="Close help" title="Close (Esc)">×</button></div>' +
      '<div class="sh-help">' +
      `<div><h3>Keyboard</h3><table>${rows(keys)}</table>` +
      (cmds.length
        ? `<h3>Palette commands</h3><table>${cmds.map((p) =>
          `<tr><td>${kbdHtml(p.keys)}</td><td>${esc(p.title)}${p.hint ? ` <span class="about">${esc(p.hint)}</span>` : ''}</td></tr>`).join('')}</table>`
        : '') +
      '<h3>Deep links</h3><div class="about">The address hash tracks where you are: ' +
      '<code>#/&lt;view&gt;[/&lt;sub&gt;][?session=…&amp;island=…&amp;worker=…]</code>. ' +
      'Share it, reload it, or use Back / Forward (full page). “full page ↗” in the flyout opens the same spot.</div></div>' +
      `<div><h3>Views</h3><table>${viewRows}</table></div>` +
      '</div></div>';
    help.querySelector('.sh-x').onclick = () => closeHelp();
    help.hidden = false;
    help.querySelector('.sh-x').focus();
  }
  function closeHelp() {
    if (help.hidden) return;
    help.hidden = true;
    if (returnFocus?.isConnected) returnFocus.focus();
  }
  help.addEventListener('mousedown', (e) => { if (e.target === help) closeHelp(); });

  const closeAll = () => { closePalette(false); closeHelp(); closeMenu(); closeTip(); };

  /* ── toolbar ───────────────────────────────────────────────────────── */

  api.addToolbarButton({
    id: 'sh-palette', label: '⌕', order: 90, title: `Command palette (${PAL_KEYS.join('+')})`,
    onClick: () => openPalette(),
  }).classList.add('icon');
  api.addToolbarButton({
    id: 'sh-help', label: '?', order: 95, title: 'Shortcuts and what each view is for (?)',
    onClick: () => openHelp(),
  }).classList.add('icon');
  for (const id of ['sh-palette', 'sh-help']) {
    const b = document.getElementById(id);
    b?.setAttribute('aria-label', b.title);
  }

  /* ── built-in palette commands ─────────────────────────────────────── */

  const fullPageUrl = () => {
    const u = new URL(location.href);
    u.searchParams.delete('mini');
    return u.href;
  };
  api.addPaletteItem({ id: 'shell.help', group: 'Commands', title: 'Show keyboard shortcuts', keys: '?', run: openHelp });
  api.addPaletteItem({
    id: 'shell.sidebar', group: 'Commands', title: 'Toggle sessions sidebar', keys: 's',
    when: sidebarApplies, run: () => setSide(document.body.classList.contains('noside')),
  });
  api.addPaletteItem({
    id: 'shell.fullpage', group: 'Commands', title: 'Open the full-page dashboard here',
    hint: 'same view, new tab', when: () => api.isMini,
    run: () => window.open(fullPageUrl(), '_blank', 'noopener'),
  });
  api.addPaletteItem({
    id: 'shell.copylink', group: 'Commands', title: 'Copy link to this view',
    when: () => !ext, // a chrome-extension:// URL means nothing outside DevTools
    run: () => {
      const url = fullPageUrl();
      Promise.resolve(navigator.clipboard?.writeText(url))
        .then(() => api.toast('Link copied', 'ok'))
        .catch(() => api.toast(url, 'info', 8000));
    },
  });
  api.addPaletteItem({
    id: 'shell.intros', group: 'Commands', title: 'Show view intros again',
    when: () => dismissed.size > 0,
    run: () => {
      dismissed.clear();
      store.set('intros-dismissed', []);
      for (const id of api.viewIntros.keys()) placeIntro(id);
    },
  });

  /* ── keyboard ──────────────────────────────────────────────────────── */

  let gAt = 0;
  function focusSearch() {
    const view = document.querySelector('.panels > .view.on');
    if (!view) return false;
    const sel = 'input[type=search], input[data-search], input[placeholder*="filter" i], input[placeholder*="search" i], input[type=text]';
    const el = [...view.querySelectorAll(sel)].find((x) => x.offsetParent !== null && !x.disabled);
    if (!el) return false;
    el.focus();
    el.select?.();
    return true;
  }
  function cycleSub(d) {
    const v = activeView();
    const btns = subButtons(v).filter(visible);
    if (btns.length < 2) return;
    const i = btns.findIndex((b) => b.classList.contains('on'));
    btns[(i + d + btns.length) % btns.length].click();
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (!e.shiftKey || ext) && k.toLowerCase() === 'k') {
      e.preventDefault();
      if (pal.hidden) openPalette(); else closePalette();
      return;
    }
    // Alt+Shift+D: same chord the overlay listens for on the host page;
    // focus is inside the iframe here, so ask the parent to toggle.
    if (embedded && e.altKey && e.shiftKey && e.code === 'KeyD') {
      e.preventDefault();
      try { window.parent.postMessage({ type: 'atoll-devtools:toggle' }, '*'); } catch { /* detached */ }
      return;
    }
    if (k === 'Escape') {
      if (!pal.hidden || !help.hidden || menu || tip) {
        e.preventDefault();
        const wasMenu = !!menu;
        closeAll();
        if (wasMenu) more.focus();
      }
      return;
    }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (!pal.hidden || !help.hidden) return;
    if (gAt && performance.now() - gAt < 1500) {
      gAt = 0;
      const v = viewForLetter(k, views());
      if (v) { e.preventDefault(); api.openView(v); }
      return;
    }
    gAt = 0;
    if (k === '?') { e.preventDefault(); openHelp(); }
    else if (k === 'g') { gAt = performance.now(); }
    else if (k === '/') { if (focusSearch()) e.preventDefault(); }
    else if (k === '[') { e.preventDefault(); cycleSub(-1); }
    else if (k === ']') { e.preventDefault(); cycleSub(1); }
    else if (k === 's' && sidebarApplies()) { e.preventDefault(); setSide(document.body.classList.contains('noside')); }
  });

  /* ── first-run tip ─────────────────────────────────────────────────── */

  let tip = null;
  function closeTip() {
    if (!tip) return;
    tip.remove();
    tip = null;
    store.set('onboarded', true);
  }
  if (!store.get('onboarded', false)) {
    setTimeout(() => {
      if (store.get('onboarded', false) || !pal.hidden || !help.hidden) return;
      tip = document.createElement('div');
      tip.className = 'sh-tip';
      tip.setAttribute('role', 'status');
      tip.innerHTML =
        `<span><b>Tip:</b> ${PAL_KEYS.map((k) => `<kbd>${k}</kbd>`).join(' ')} jumps to any view, island or worker. ` +
        '<kbd>?</kbd> lists shortcuts and what each view is for.</span>' +
        '<button type="button" class="act" data-a="palette">Open palette</button>' +
        '<button type="button" class="act" data-a="ok">Got it</button>';
      tip.onclick = (e) => {
        const a = e.target.closest('button')?.dataset.a;
        if (!a) return;
        closeTip();
        if (a === 'palette') openPalette();
      };
      document.body.append(tip);
    }, 1200);
  }

  /* ── initial route ─────────────────────────────────────────────────── */

  const initial = parseRoute(location.hash) ?? parseRoute(store.get(`last:${ctx}`, ''));
  if (!initial || !applyRoute(initial)) writeRoute();
}
