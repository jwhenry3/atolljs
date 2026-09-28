/**
 * The shell — main-thread orchestration for the islands demo.
 *
 * Three independent React trees render on this page, each reconciled inside
 * its OWN Web Worker (one connectWorker client per island, poolSize 1 — see
 * island.ts for why pooling can't go wider). The shell:
 *
 *   - creates the layout + per-island containers and badges,
 *   - mounts one registry app per island via mountIsland(),
 *   - mediates island → island traffic through `onEvent` + `updateProps`:
 *       controls emits filterChanged/sortChanged → table.updateProps(...)
 *       table emits rowsChanged → stats.updateProps({visible, total})
 *       table emits rowSelected / controls emits countChanged → status line
 *
 * There is still NO React on this thread — every visible element below the
 * toolbar arrives via op replay.
 */
import { connectIslandWorker, mountIsland, type IslandHandle, type Mode } from './island';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing from index.html');
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from index.html`);
  return el;
};

/* ── Shell state + status line ──────────────────────────────────────────── */

const state = { filter: '', desc: false };
const islands: IslandHandle[] = [];
let mode: Mode = 'push';

const statusEl = $('status-line');
const setStatus = (msg: string): void => {
  statusEl.textContent = msg;
};

/* ── Transport toolbar (global — drives every island's mode) ────────────── */

const pushBtn = $('push-btn') as HTMLButtonElement;
const pollBtn = $('poll-btn') as HTMLButtonElement;
const statsEl = $('transport-stats');

function renderStats(): void {
  pushBtn.style.fontWeight = mode === 'push' ? '700' : '400';
  pollBtn.style.fontWeight = mode === 'poll' ? '700' : '400';
  const flushes = islands.reduce((a, i) => a + i.flushCalls, 0);
  const ops = islands.reduce((a, i) => a + i.opsApplied, 0);
  statsEl.textContent = `sync: ${mode} · flush calls: ${flushes} · ops applied: ${ops}`;
}

function setMode(next: Mode): void {
  mode = next;
  // setMode after all mounts — the doorbell binds lazily (see island.ts).
  for (const island of islands) island.setMode(next);
  renderStats();
}

pushBtn.onclick = () => setMode('push');
pollBtn.onclick = () => setMode('poll');

/* ── Boot ───────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  // Mount order: stats first so the table's initial rowsChanged emit has a
  // listener, then table, then controls (its events only travel outward).
  const stats = await mountIsland({
    client: connectIslandWorker(),
    el: $('island-stats'),
    app: 'stats',
    props: { visible: 2000, total: 2000 },
    onActivity: renderStats,
  });
  islands.push(stats);
  $('badge-stats').textContent = `worker ${stats.pid}`;

  const table = await mountIsland({
    client: connectIslandWorker(),
    el: $('island-table'),
    app: 'data-table',
    props: { filter: state.filter, desc: state.desc },
    onEvent: (name, payload) => {
      const p = payload as { count?: number; id?: number };
      // The shell mediates: one island's emit becomes another's props.
      if (name === 'rowsChanged') void stats.updateProps({ visible: p.count ?? 0, total: 2000 });
      if (name === 'rowSelected') setStatus(`table island emitted rowSelected → shell (row #${p.id})`);
    },
    onActivity: renderStats,
  });
  islands.push(table);
  $('badge-table').textContent = `worker ${table.pid}`;

  const controls = await mountIsland({
    client: connectIslandWorker(),
    el: $('island-controls'),
    app: 'controls',
    onEvent: (name, payload) => {
      const p = payload as { filter?: string; desc?: boolean; count?: number };
      if (name === 'filterChanged') {
        state.filter = p.filter ?? '';
        void table.updateProps({ filter: state.filter, desc: state.desc });
        setStatus(`controls emitted filterChanged → table.updateProps("${state.filter}")`);
      }
      if (name === 'sortChanged') {
        state.desc = p.desc ?? false;
        void table.updateProps({ filter: state.filter, desc: state.desc });
        setStatus(`controls emitted sortChanged → table.updateProps(desc=${state.desc})`);
      }
      if (name === 'countChanged') setStatus(`controls island counter → ${p.count} (state stayed in the worker)`);
    },
    onActivity: renderStats,
  });
  islands.push(controls);
  $('badge-controls').textContent = `worker ${controls.pid}`;

  setMode('push');
  setStatus('three islands mounted — each badge is a different worker realm');
}

void main();
