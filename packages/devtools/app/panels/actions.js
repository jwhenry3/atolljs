// Live controls on the inspectors: kill a worker / inject chaos on its pool
// (worker inspector), edit props / switch push-poll mode (island inspector).
// Every control goes through api.control and is gated on the app having
// registered the command (api.hasCommand) and the session being live.
//
// Inspector hooks fire on every render: the controls are built once per
// inspected key and only their disabled/title state is touched afterwards.

import { toast } from './toast.js';

/** sid → pool.list result ([{ poolId, label, size, dedicated, chaos }]). */
const poolLists = new Map();

const CSS = `
.act-row { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.act-row .chaos { display:inline-flex; gap:4px; align-items:center; border:1px solid #30363d; border-radius:6px; padding:2px 6px; }
.act-row .chaos input { width:56px; background:#0d1117; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:1px 4px; font:inherit; }
.act-row .chaos .st { color:#8b949e; font-size:11px; }
.act-row .chaos .st.on { color:#d29922; }
.act-props { margin:0 0 10px; }
.act-props textarea { width:100%; min-height:140px; box-sizing:border-box; background:#0d1117; color:#c9d1d9; border:1px solid #30363d; border-radius:6px; padding:6px; font:12px/1.4 ui-monospace,monospace; }
.act-props .err { color:#ff7b72; font-size:12px; min-height:1em; }
.act-props .row { display:flex; gap:6px; margin-top:4px; }
`;

const injectCss = () => {
  if (document.getElementById('act-css')) return;
  const s = document.createElement('style');
  s.id = 'act-css';
  s.textContent = CSS;
  document.head.appendChild(s);
};

const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids) el.append(c);
  return el;
};

/** Set disabled + tooltip only when they change (render-rate safe). */
const gate = (el, reason, title) => {
  const off = reason !== null;
  if (el.disabled !== off) el.disabled = off;
  const t = off ? reason : title;
  if (el.title !== t) el.title = t;
};

/** Mount (once) a container owned by this panel inside an inspector's actions div. */
const ownBox = (actions, id) => {
  let box = actions.querySelector(`:scope > [data-act="${id}"]`);
  if (!box) {
    box = h('div', { className: 'act-row', 'data-act': id, style: 'display:contents' });
    actions.appendChild(box);
  }
  return box;
};

const chaosText = (c) => {
  if (!c) return 'chaos: off';
  const parts = [];
  if (c.delayMs) parts.push(`+${c.delayMs}ms`);
  if (c.failRate) parts.push(`${Math.round(c.failRate * 100)}% fail`);
  if (c.timeoutRate) parts.push(`${Math.round(c.timeoutRate * 100)}% timeout`);
  return `chaos: ${parts.join(' · ')}`;
};

export function setup(api) {
  injectCss();

  /** Why a control on session `sid` is unavailable, or null when usable. */
  const blocked = (sid, cmd) => {
    if (api.livePaused) return 'Viewing a recording: controls are off';
    if (api.state.sessions.get(sid)?.closed) return 'Session has ended';
    if (!api.hasCommand(sid, cmd)) return `The app does not expose '${cmd}' (devtools off for this runner, or an older app)`;
    return null;
  };

  const refreshPools = (sid) =>
    api.control(sid, 'pool.list', {}, 3000)
      .then((list) => { poolLists.set(sid, list); api.scheduleRender(); return list; })
      .catch(() => []);

  const killWorker = async (sid, poolId, slot) => {
    if (!confirm(`Kill ${poolId} slot ${slot}?\n\nRuns the crash path: in-flight calls reject with WorkerCrashedError, and the worker respawns if the runner allows it.`)) return;
    try {
      await api.control(sid, 'worker.kill', { poolId, slot });
      toast(`Killed ${poolId}#${slot}`);
    } catch (err) {
      toast(err, 'error');
    }
  };

  /* ── worker inspector ─────────────────────────────────────────────────── */

  let wk = null; // { key, sid, poolId, slot, nested, els }
  let wkTicks = 0;

  const buildWorker = (actions, key) => {
    const [sid, poolId, slotStr] = key.split('|');
    const slot = Number(slotStr);
    const box = ownBox(actions, 'worker');
    box.replaceChildren();
    const kill = h('button', { className: 'danger', textContent: 'Kill worker', onclick: () => killWorker(sid, poolId, slot) });
    const delay = h('input', { type: 'number', min: '0', step: '50', placeholder: 'ms', 'data-tip': 'Delay before each call is posted (ms)' });
    const fail = h('input', { type: 'number', min: '0', max: '100', step: '5', placeholder: '%', 'data-tip': 'Share of calls failed with "chaos: injected failure"' });
    const tout = h('input', { type: 'number', min: '0', max: '100', step: '5', placeholder: '%', 'data-tip': 'Share of calls failed through the timeout path' });
    const status = h('span', { className: 'st', textContent: 'chaos: …' });
    const send = async (args) => {
      try {
        const active = await api.control(sid, 'pool.chaos', { poolId, ...args });
        toast(active ? `${poolId}: ${chaosText(active)}` : `${poolId}: chaos cleared`);
        refreshPools(sid);
      } catch (err) {
        toast(err, 'error');
      }
    };
    const apply = h('button', {
      textContent: 'Apply',
      'data-tip': `Inject faults into every call on ${poolId}`,
      onclick: () => {
        const num = (el) => (el.value === '' ? undefined : Number(el.value));
        const d = num(delay); const f = num(fail); const t = num(tout);
        send({ delayMs: d, failRate: f === undefined ? undefined : f / 100, timeoutRate: t === undefined ? undefined : t / 100 });
      },
    });
    const clear = h('button', { textContent: 'Clear', 'data-tip': 'Remove chaos from this runner', onclick: () => send({}) });
    const chaos = h('span', { className: 'chaos' },
      h('span', { textContent: 'Chaos' }), 'delay', delay, 'fail', fail, 'timeout', tout, apply, clear, status);
    box.append(kill, chaos);
    wk = { key, sid, poolId, slot, nested: poolId.includes('~'), filled: false, els: { kill, delay, fail, tout, apply, clear, status } };
    if (!blocked(sid, 'pool.list')) refreshPools(sid);
  };

  const updateWorker = (w) => {
    const { sid, poolId, nested, els } = wk;
    const nestedWhy = nested ? 'Runs inside a worker: nested pools are not reachable from the dashboard' : null;
    gate(els.kill, nestedWhy ?? (w.dead ? 'Worker is down' : blocked(sid, 'worker.kill')),
      'Kill this worker as if it crashed (in-flight calls reject, respawn when enabled)');
    const chaosWhy = nestedWhy ?? blocked(sid, 'pool.chaos');
    for (const el of [els.delay, els.fail, els.tout, els.apply, els.clear]) gate(el, chaosWhy, el.dataset.tip);
    const entry = poolLists.get(sid)?.find((p) => p.poolId === poolId);
    const text = entry ? chaosText(entry.chaos) : chaosWhy ? '' : 'chaos: …';
    if (els.status.textContent !== text) els.status.textContent = text;
    els.status.classList.toggle('on', !!entry?.chaos);
    // Prefill the form from the active config once, never while the user types.
    if (entry && !wk.filled && !els.delay.matches(':focus') && !els.fail.matches(':focus') && !els.tout.matches(':focus')) {
      wk.filled = true;
      els.delay.value = entry.chaos?.delayMs ?? '';
      els.fail.value = entry.chaos?.failRate ? Math.round(entry.chaos.failRate * 100) : '';
      els.tout.value = entry.chaos?.timeoutRate ? Math.round(entry.chaos.timeoutRate * 100) : '';
    }
  };

  api.onInspectWorker((key, w, { actions }) => {
    if (!actions) return;
    if (!wk || wk.key !== key || !actions.contains(wk.els.kill)) buildWorker(actions, key);
    updateWorker(w);
  });

  // Chaos can change from another dashboard or the palette: poll while inspected.
  api.onTick(() => {
    if (!wk || api.state.inspectWorker !== wk.key || ++wkTicks % 5) return;
    if (!blocked(wk.sid, 'pool.list')) refreshPools(wk.sid);
  });

  /* ── island inspector ─────────────────────────────────────────────────── */

  let isl = null; // { key, sid, instance, els, open, mode }

  const loadProps = async () => {
    const { sid, instance, els } = isl;
    els.err.textContent = '';
    els.ta.value = 'loading…';
    try {
      const res = await api.control(sid, 'island.props', { instance });
      if (isl?.instance !== instance) return;
      els.ta.value = res?.props !== undefined ? JSON.stringify(res.props, null, 2) : (res?.preview ?? '{}');
    } catch (err) {
      els.ta.value = '';
      els.err.textContent = err.message;
    }
  };

  const applyProps = async () => {
    const { sid, instance, els } = isl;
    let props;
    try {
      props = JSON.parse(els.ta.value);
    } catch (err) {
      els.err.textContent = `Invalid JSON: ${err.message}`;
      return;
    }
    if (props === null || typeof props !== 'object' || Array.isArray(props)) {
      els.err.textContent = 'Props must be a JSON object';
      return;
    }
    els.err.textContent = '';
    try {
      await api.control(sid, 'island.updateProps', { instance, props });
      toast(`${instance}: props updated`);
    } catch (err) {
      els.err.textContent = err.message;
      toast(err, 'error');
    }
  };

  const setMode = async (mode) => {
    const { sid, instance } = isl;
    try {
      const res = await api.control(sid, 'island.setMode', { instance, mode });
      if (isl?.instance === instance) isl.mode = res?.mode ?? mode;
      toast(`${instance}: ${res?.mode ?? mode} mode`);
      api.scheduleRender();
    } catch (err) {
      toast(err, 'error');
    }
  };

  const buildIsland = (actions, key) => {
    const sid = key.split('|')[0];
    const instance = key.split('|').slice(1).join('|');
    const box = ownBox(actions, 'island');
    box.replaceChildren();
    const edit = h('button', { textContent: 'Edit props', onclick: () => toggleEditor() });
    const push = h('button', { textContent: 'Push', onclick: () => setMode('push') });
    const poll = h('button', { textContent: 'Poll', onclick: () => setMode('poll') });
    const mode = h('span', { className: 'chaos' }, h('span', { textContent: 'Mode' }), push, poll);
    box.append(edit, mode);

    const ta = h('textarea', { spellcheck: false });
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); applyProps(); }
    });
    const err = h('div', { className: 'err' });
    const apply = h('button', { textContent: 'Apply', title: 'Send island.updateProps (Ctrl+Enter)', onclick: () => applyProps() });
    const reload = h('button', { textContent: 'Reload', title: 'Re-read the current props from the app', onclick: () => loadProps() });
    const close = h('button', { textContent: 'Close', onclick: () => toggleEditor(false) });
    const editor = h('div', { className: 'act-props', style: 'display:none;flex-basis:100%' },
      ta, err, h('div', { className: 'row' }, apply, reload, close));
    box.append(editor);
    isl = { key, sid, instance, open: false, mode: null, els: { edit, push, poll, editor, ta, err, apply, reload } };
  };

  const toggleEditor = (open = !isl.open) => {
    isl.open = open;
    isl.els.editor.style.display = open ? 'block' : 'none';
    isl.els.edit.textContent = open ? 'Hide props' : 'Edit props';
    if (open) loadProps();
  };

  const updateIsland = (island) => {
    const { sid, els } = isl;
    const ended = island.ended ? 'Island is unmounted' : null;
    const propsWhy = ended ?? blocked(sid, 'island.updateProps');
    gate(els.edit, propsWhy && !isl.open ? propsWhy : null, 'Edit the island props as JSON (island.updateProps)');
    gate(els.apply, propsWhy, 'Send island.updateProps (Ctrl+Enter)');
    gate(els.reload, ended ?? blocked(sid, 'island.props'), 'Re-read the current props from the app');
    const modeWhy = ended ?? blocked(sid, 'island.setMode');
    gate(els.push, modeWhy, "Push mode: the SharedArrayBuffer doorbell triggers flushes (polls anyway on a doorbell-free client)");
    gate(els.poll, modeWhy, 'Poll mode: the main thread drains ops every 50ms');
    const fw = (b, on) => { if (b.classList.contains('on') !== on) b.classList.toggle('on', on); b.style.borderColor = on ? '#58a6ff' : ''; };
    fw(els.push, isl.mode === 'push');
    fw(els.poll, isl.mode === 'poll');
  };

  api.onInspectIsland((key, island, { actions }) => {
    if (!actions || !key) return;
    if (!isl || isl.key !== key || !actions.contains(isl.els.edit)) buildIsland(actions, key);
    updateIsland(island);
  });

  api.onReset(() => {
    poolLists.clear();
    wk = null;
    isl = null;
  });

  /* ── palette ──────────────────────────────────────────────────────────── */

  api.addPaletteItem({
    id: 'actions.chaos-clear-all',
    title: 'Chaos: clear all',
    group: 'Actions',
    hint: 'Remove fault injection from every runner in every live session',
    run: async () => {
      let n = 0;
      for (const s of api.liveSessions()) {
        if (!api.hasCommand(s.id, 'pool.chaos')) continue;
        const list = await refreshPools(s.id);
        for (const p of list.filter((x) => x.chaos)) {
          try {
            await api.control(s.id, 'pool.chaos', { poolId: p.poolId });
            n++;
          } catch (err) {
            toast(err, 'error');
          }
        }
        refreshPools(s.id);
      }
      toast(n ? `Cleared chaos on ${n} runner(s)` : 'No runner had chaos set', n ? 'ok' : 'info');
    },
  });

  api.addPaletteItem({
    id: 'actions.kill-inspected',
    title: 'Kill inspected worker',
    group: 'Actions',
    hint: 'Crash the worker open in the worker inspector',
    run: () => {
      const key = api.state.inspectWorker;
      if (!key) return toast('No worker is being inspected', 'info');
      const [sid, poolId, slot] = key.split('|');
      const why = poolId.includes('~') ? 'Nested pools are not reachable from the dashboard' : blocked(sid, 'worker.kill');
      if (why) return toast(why, 'error');
      killWorker(sid, poolId, Number(slot));
    },
  });
}
