/**
 * The React shell — the same seven-island page as index.html, but the shell
 * itself is a React app mounting islands through `<Island/>`
 * (@jwhenry123/mesh-worker-dom/react).
 *
 * What changes versus main.ts:
 *   - `mountIsland({ el, ... })` becomes `<Island app={…} onEvent={…} />` —
 *     the div it renders IS the island container; badges come from onReady.
 *   - Mediation is real data flow: a controls emit is setState, the table's
 *     props are that state — the component's updateProps call replaces the
 *     hand-wired `table.updateProps(...)` (and dedups repeats).
 *   - app takes the stamped component itself for the charts island —
 *     `<Island app={ChartsApp} props={{ width }} />` — so props typecheck
 *     against ChartsProps, not a string name.
 *   - setMode/badges/stats ride ordinary React state + a handles map.
 *
 * The islands themselves are unchanged — the demo proves the op protocol
 * serves both shell styles: framework-free (index.html) and React.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Island } from '@jwhenry123/mesh-worker-dom/react';
import type { IslandHandle, Mode } from '@jwhenry123/mesh-worker-dom';
import { ChartsApp } from './worker/apps';
// Leaflet's stylesheet is shell-side: the worker fabricates the DOM Leaflet
// builds but CSS was always the shell's job.
import 'leaflet/dist/leaflet.css';

/** One fresh worker per island — poolSize is pinned to 1 inside connectIslandWorker. */
const renderWorker = (): Worker =>
  new Worker(new URL('./worker/render.worker.ts', import.meta.url), { type: 'module' });

/* ── Transclusion demo: a live canvas the SHELL owns inside a worker tree ─ */

function mountSparkline(el: HTMLElement | null): void {
  const holder = mountSparkline as unknown as { raf?: number };
  if (holder.raf !== undefined) cancelAnimationFrame(holder.raf);
  holder.raf = undefined;
  if (el === null) return; // unmounted by the worker tree — stop drawing

  // ownerDocument, not the global — in-process tests share globalThis with the
  // worker realm dispatcher, so `document` can resolve to a proxy document.
  const canvas = el.ownerDocument.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;border-radius:4px;background:#0d1117';
  el.appendChild(canvas);
  // getContext can return null (happy-dom has no canvas impl) — the slot
  // element still gets its box; the animation just skips that environment.
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const trace: number[] = [];
  const tick = (t: number): void => {
    const w = (canvas.width = el.clientWidth);
    const h = (canvas.height = el.clientHeight);
    trace.push((Math.sin(t / 320) + Math.sin(t / 97) * 0.5) / 1.5);
    if (trace.length > w) trace.shift();
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    trace.forEach((v, i) => {
      const y = h / 2 + v * h * 0.4;
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    });
    ctx.stroke();
    holder.raf = requestAnimationFrame(tick);
  };
  holder.raf = requestAnimationFrame(tick);
}

/* ── Shell ──────────────────────────────────────────────────────────────── */

function IslandPanel(props: {
  title: string;
  badge?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="island">
      <div className="island-head">
        <span>{props.title}</span>
        <span className="badge">{props.badge ?? 'worker …'}</span>
      </div>
      {props.children}
    </section>
  );
}

export function Shell({ worker = renderWorker }: { worker?: () => Worker }): ReactElement {
  // Mediation state — controls emit → state → props on other islands.
  const [filter, setFilter] = useState('');
  const [desc, setDesc] = useState(false);
  const [visible, setVisible] = useState(2000);
  const [status, setStatus] = useState('mounting islands…');
  const [mode, setModeState] = useState<Mode>('push');
  const [pids, setPids] = useState<Record<string, string>>({});
  const [statsTick, setStatsTick] = useState(0);

  /** Every mounted island's handle — setMode + the aggregate stats read them. */
  const handles = useRef(new Map<string, IslandHandle>());
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const ready = (key: string) => (h: IslandHandle): void => {
    handles.current.set(key, h);
    h.setMode(modeRef.current); // doorbell binds lazily — set on ready
    setPids((p) => ({ ...p, [key]: `worker ${h.pid}` }));
    setStatsTick((t) => t + 1);
  };
  const bump = (): void => setStatsTick((t) => t + 1);

  useEffect(() => {
    for (const h of handles.current.values()) h.setMode(mode);
    bump();
  }, [mode]);

  const slots = useMemo(() => ({ wave: mountSparkline }), []);
  const flushes = [...handles.current.values()].reduce((a, i) => a + i.flushCalls, 0);
  const ops = [...handles.current.values()].reduce((a, i) => a + i.opsApplied, 0);
  void statsTick; // re-render trigger for the aggregate read

  return (
    <>
      <h1>React islands — React shell edition</h1>
      <p style={{ font: '12px monospace', color: '#9aa4b2', marginTop: -8 }}>
        same workers, same registry — the shell is React + <code>{'<Island/>'}</code>.{' '}
        <a href="/" style={{ color: '#7fb6ff' }}>framework-free shell →</a>
      </p>
      <div id="transport-bar">
        <span>transport:</span>
        <button
          id="push-btn"
          style={{ fontWeight: mode === 'push' ? 700 : 400 }}
          onClick={() => setModeState('push')}
        >
          push (SAB doorbell)
        </button>
        <button
          id="poll-btn"
          style={{ fontWeight: mode === 'poll' ? 700 : 400 }}
          onClick={() => setModeState('poll')}
        >
          poll (50ms)
        </button>
        <span id="transport-stats">
          sync: {mode} · flush calls: {flushes} · ops applied: {ops}
        </span>
      </div>
      <div id="status-line">{status}</div>

      <IslandPanel title="app: controls" badge={pids.controls}>
        <Island
          worker={renderWorker}
          app="controls"
          className="island-root"
          onReady={ready('controls')}
          onActivity={bump}
          onEvent={(name, payload) => {
            const p = payload as { filter?: string; desc?: boolean; count?: number };
            if (name === 'filterChanged') {
              setFilter(p.filter ?? '');
              setStatus(`controls emitted filterChanged → table props.filter="${p.filter}"`);
            }
            if (name === 'sortChanged') {
              setDesc(p.desc ?? false);
              setStatus(`controls emitted sortChanged → table props.desc=${p.desc}`);
            }
            if (name === 'countChanged')
              setStatus(`controls island counter → ${p.count} (state stayed in the worker)`);
          }}
        />
      </IslandPanel>

      <IslandPanel title="app: data-table" badge={pids.table}>
        <Island
          worker={renderWorker}
          app="data-table"
          // The mediation IS this line — controls' emits land as props here.
          props={{ filter, desc }}
          className="island-root"
          id="island-table"
          onReady={ready('table')}
          onActivity={bump}
          onEvent={(name, payload) => {
            const p = payload as { count?: number; id?: number };
            if (name === 'rowsChanged') setVisible(p.count ?? 0);
            if (name === 'rowSelected')
              setStatus(`table island emitted rowSelected → shell (row #${p.id})`);
          }}
        />
      </IslandPanel>

      <IslandPanel
        title="app: data-table (second instance — same microfrontend, different worker + props)"
        badge={pids.table2}
      >
        <Island
          worker={renderWorker}
          app="data-table"
          props={{ filter: 'eu-central', desc: true }}
          className="island-root"
          id="island-table-2"
          onReady={ready('table2')}
          onActivity={bump}
          onEvent={(name, payload) => {
            const p = payload as { id?: number };
            if (name === 'rowSelected')
              setStatus(`second data-table instance emitted rowSelected (row #${p.id})`);
          }}
        />
      </IslandPanel>

      <IslandPanel title="app: stats" badge={pids.stats}>
        <Island
          worker={renderWorker}
          app="stats"
          props={{ visible, total: 2000, spark: 'wave' }}
          slots={slots}
          className="island-root"
          onReady={ready('stats')}
          onActivity={bump}
        />
      </IslandPanel>

      <IslandPanel
        title="app: vanilla (imperative proxy DOM — no React in this worker)"
        badge={pids.vanilla}
      >
        <Island
          worker={renderWorker}
          app="vanilla"
          props={{ title: 'vanilla island — imperative proxy DOM, zero React in this worker' }}
          className="island-root"
          onReady={ready('vanilla')}
          onActivity={bump}
          onEvent={(name, payload) => {
            const p = payload as { color?: string; x?: number; y?: number };
            if (name === 'colorPicked')
              setStatus(`vanilla island emitted colorPicked → ${p.color} @ (${p.x}, ${p.y})`);
          }}
        />
      </IslandPanel>

      <IslandPanel
        title="app: charts (real recharts — mounted by component reference)"
        badge={pids.charts}
      >
        <Island
          worker={renderWorker}
          // The component-reference mount — props below infer as ChartsProps.
          app={ChartsApp}
          props={{ width: 600, height: 260 }}
          className="island-root"
          onReady={ready('charts')}
          onActivity={bump}
          onEvent={(name, payload) => {
            const p = payload as { region?: string; incidents?: number };
            if (name === 'chartClicked')
              setStatus(`charts island emitted chartClicked → ${p.region} (${p.incidents} incidents)`);
          }}
        />
      </IslandPanel>

      <IslandPanel
        title="app: map (real Leaflet 1.9 — unmodified — on the proxy DOM)"
        badge={pids.map}
      >
        <Island
          worker={renderWorker}
          app="map"
          className="island-root"
          id="island-map"
          onReady={ready('map')}
          onActivity={bump}
          onEvent={(name, payload) => {
            const p = payload as { label?: string; name?: string; zoom?: number };
            if (name === 'markerClicked') setStatus(`map island emitted markerClicked → ${p.label}`);
            if (name === 'placeSelected') setStatus(`map island emitted placeSelected → ${p.name}`);
            if (name === 'zoomChanged') setStatus(`map island emitted zoomChanged → zoom ${p.zoom}`);
          }}
        />
      </IslandPanel>
    </>
  );
}

// Guarded so the module is import-safe in tests (they render <Shell/> directly).
const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<Shell />);
