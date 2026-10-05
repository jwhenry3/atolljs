/**
 * The React islands demo — REACT RUNNING INSIDE WORKERS.
 *
 * Each island below mounts an app from `worker/react.worker.tsx`'s
 * registry: ordinary React components (useState/useLayoutEffect) rendered
 * by react-reconciler into serialized DOM ops. The worker bundle carries
 * React; this page is just a thin host that replays its ops.
 *
 * What changes versus main.ts (the seven-island demo):
 *   - The shell itself is React — each island is an <Island/> element, a
 *     islandComponent facade, or a lazyIsland contract module.
 *   - `client` (not `worker:`) is passed so the doorbell choice travels
 *     with the connection; the two counters deliberately share ONE client
 *     so their islands live in the same OS worker.
 *   - Mediation is plain React state: worker emits land in onEvent →
 *     setState → the status line.
 *
 * The ops console at the bottom mounts a SECOND PolyWorker definition
 * (worker/console.worker.tsx) three ways: compute inline on a shared
 * client, compute offloaded to a `workers: 1` compute worker, and nested
 * (render sub-worker for the cards, a `workers: 3` compute pool for them).
 *
 * The seven-island demo lives in index.html — this page is the small
 * framework-island edition matching vue/solid/svelte/angular-shell.html.
 */
import { useEffect, useRef, useState, Suspense } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Island, islandComponent, lazyIsland } from '@atolljs/react-island';
import { connectIslandWorker } from '@atolljs/islands';
import type { IslandHandle, Mode } from '@atolljs/islands';
import { initDevtools } from '@atolljs/devtools';

/** The registry worker — one script serving all three React apps. */
const reactWorker = (): Worker =>
  new Worker(new URL('./worker/react.worker.tsx', import.meta.url), { type: 'module' });

// SharedArrayBuffer only exists in cross-origin-isolated contexts — on
// hosts without COOP/COEP (GitHub Pages where coi-sw.js didn't take, or a
// browser without `credentialless`) the doorbell can't bind, so every
// island runs its 50ms poll transport instead of push.
const isolated =
  typeof SharedArrayBuffer !== 'undefined' &&
  (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated);
const initialMode: Mode = isolated ? 'push' : 'poll';

// Sink before any island mounts — workers only forward events when the
// flag reaches them at INIT. No-op without ?__atoll_devtools.
initDevtools({
  session: { name: 'islands-react-shell', framework: 'react' },
  overlay: { src: '__atoll/?mini=1' },
});

/**
 * Two clients = two OS workers running the same script. The counters share
 * one client (one worker, two 'counter@N' instances); notes gets its own —
 * and the incidents benchmark carries a third worker through its contract
 * module below.
 */
const counterClient = connectIslandWorker({ name: 'counters', worker: reactWorker, doorbell: isolated });
const notesClient = connectIslandWorker({ name: 'notes', worker: reactWorker, doorbell: isolated });

/**
 * The facades — mount worker apps this shell never imports. Notes goes
 * through an eager proxy component (the string is the registry key);
 * incidents is lazy: a dynamic import + contract module that carries its
 * OWN worker, so the 1M-row benchmark can't contend with anything else
 * and its chunk only loads when the island mounts.
 */
const NotesIsland = islandComponent<{ title?: string }>('notes');
const IncidentsIsland = lazyIsland(() => import('./incidents.island'));

/**
 * The ops console: a SECOND PolyWorker definition, spawned three ways
 * below. `opsInline` and `opsOffload` are each one render worker hosting
 * two instances: the first computes inline (and stalls), the second sends
 * the export to a compute worker. 'regions' passes `worker={consoleWorker}`
 * and nests a render sub-worker plus compute workers inside its worker.
 */
const consoleWorker = (): Worker =>
  new Worker(new URL('./worker/console.worker.tsx', import.meta.url), { type: 'module' });
const opsInline = connectIslandWorker({ name: 'ops-inline', worker: consoleWorker, doorbell: isolated });
const opsOffload = connectIslandWorker({ name: 'ops-offload', worker: consoleWorker, doorbell: isolated });

/** Main-thread heartbeat: proves the page never stalls, whatever the workers do. */
function MainHeartbeat(): ReactElement {
  const [beats, setBeats] = useState(0);
  const [worst, setWorst] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    last.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const late = Math.max(0, now - last.current - 250);
      last.current = now;
      setBeats((b) => b + 1);
      if (late > 50) setWorst((w) => Math.max(w, Math.round(late)));
    }, 250);
    return () => clearInterval(id);
  }, []);
  return (
    <div id="main-heartbeat" className="ops-main">
      <span className={`ops-dot ${beats % 2 ? 'on' : ''}`} /> main thread · ticks {beats} ·{' '}
      <span className={`ops-stall ${worst ? 'hit' : ''}`}>longest stall {worst}ms</span>
    </div>
  );
}

/* ── Shell ──────────────────────────────────────────────────────────────── */

const loading = (
  <div className="island-root" style={{ color: '#7d8a9c' }}>
    loading worker module…
  </div>
);

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

export function Shell(): ReactElement {
  // Mediation state — worker emits land here; the status line renders it.
  const [status, setStatus] = useState('mounting islands…');
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [pids, setPids] = useState<Record<string, string>>({});
  const [statsTick, setStatsTick] = useState(0);

  /** Every mounted island's handle — setMode + the aggregate stats read them. */
  const handles = useRef(new Map<string, IslandHandle>());
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const ready = (key: string) => (h: IslandHandle): void => {
    handles.current.set(key, h);
    h.setMode(modeRef.current); // applies the user's pick to late-mounting islands
    setPids((p) => ({ ...p, [key]: `worker ${h.pid}` }));
    setStatsTick((t) => t + 1);
  };
  const bump = (): void => setStatsTick((t) => t + 1);

  const setMode = (next: Mode): void => {
    setModeState(next);
    for (const h of handles.current.values()) h.setMode(next);
    bump();
  };

  const flushes = [...handles.current.values()].reduce((a, i) => a + i.flushCalls, 0);
  const ops = [...handles.current.values()].reduce((a, i) => a + i.opsApplied, 0);
  void statsTick; // re-render trigger for the aggregate read

  const counterOpts = (label: string, key: string) => ({
    client: counterClient,
    app: 'counter',
    props: { label },
    mode: initialMode,
    onReady: ready(key),
    onActivity: bump,
    framework: 'react',
    onEvent: (name: string, payload: unknown) => {
      const p = payload as { count?: number; label?: string };
      if (name === 'incremented')
        setStatus(`${p.label} counter → ${p.count} (React state stayed in the worker)`);
    },
  });

  return (
    <>
      <h1>React islands — React in the worker</h1>
      <p style={{ font: '12px monospace', color: '#9aa4b2', marginTop: -8 }}>
        registry worker + shared client — the worker bundle carries React, the shell is a thin{' '}
        <code>{'<Island/>'}</code> + <code>islandComponent</code>/<code>lazyIsland</code> host.{' '}
        <a href="./index.html" style={{ color: '#7fb6ff' }}>framework-free shell →</a>
      </p>

      <div id="transport-bar">
        <span>transport:</span>
        <label
          id="transport-toggle"
          title={isolated ? 'push via SharedArrayBuffer doorbell — off falls back to 50ms polling' : 'needs cross-origin isolation (no SharedArrayBuffer)'}
        >
          <input
            id="push-toggle"
            type="checkbox"
            checked={mode === 'push'}
            disabled={!isolated}
            onChange={() => setMode(mode === 'push' ? 'poll' : 'push')}
          />
          push (SAB doorbell)
        </label>
        <span id="transport-stats">
          sync: {mode} · flush calls: {flushes} · ops applied: {ops}
        </span>
      </div>
      <div id="status-line">{status}</div>

      <IslandPanel title="app: counter (react-reconciler — this worker has no DOM)" badge={pids.counter}>
        <Island {...counterOpts('alpha', 'counter')} className="island-root" />
      </IslandPanel>

      <IslandPanel
        title="app: counter — second instance (SAME worker as the first, one client)"
        badge={pids.counter2}
      >
        <Island {...counterOpts('beta', 'counter2')} className="island-root" />
      </IslandPanel>

      <IslandPanel
        title="app: nestedhost — an island INSIDE an island (worker → sub-worker)"
        badge={pids.nestedhost}
      >
        <Island
          client={counterClient}
          app="nestedhost"
          framework="react"
          props={{ label: 'inner counter' }}
          mode={initialMode}
          onReady={ready('nestedhost')}
          onActivity={bump}
          onEvent={(name, payload) => {
            const p = payload as { count?: number; label?: string };
            if (name === 'nestedIncremented')
              setStatus(
                `nested island → ${p.count} — emitted in the SUB-worker, relayed through the parent island`,
              );
          }}
          className="island-root"
        />
      </IslandPanel>

      <IslandPanel
        title="app: notes — islandComponent facade (attrs ARE the props)"
        badge={pids.notes}
      >
        <NotesIsland
          client={notesClient}
          framework="react"
          title="react island"
          onReady={ready('notes')}
          onActivity={bump}
          onEvent={(name, payload) => {
            const p = payload as { text?: string; total?: number };
            if (name === 'noteAdded')
              setStatus(`notes island emitted noteAdded → "${p.text}" (${p.total} total)`);
          }}
          containerProps={{ className: 'island-root' }}
        />
      </IslandPanel>

      <IslandPanel
        title="app: incidents — lazyIsland + contract module (own worker, 1M rows)"
        badge={pids.incidents}
      >
        <Suspense fallback={loading}>
          <IncidentsIsland
            // The contract supplies the worker; workerOptions carries the
            // doorbell choice through to the shorthand client it builds.
            workerOptions={{ doorbell: isolated }}
            framework="react"
            mode={initialMode}
            onReady={ready('incidents')}
            onActivity={bump}
            onEvent={(name, payload) => {
              const p = payload as { start?: number; end?: number; ms?: number };
              if (name === 'rendered')
                setStatus(
                  `incidents island rendered rows ${p.start?.toLocaleString()}–${p.end?.toLocaleString()} in ${p.ms?.toFixed(1)}ms (of 1,000,000)`,
                );
            }}
            containerProps={{ className: 'island-root' }}
          />
        </Suspense>
      </IslandPanel>

      <h2 id="ops-console">Ops console: render workers render, compute workers compute</h2>
      <p className="ops-intro">
        Every panel below mounts an app from the SAME definition,{' '}
        <code>worker/console.worker.tsx</code>. Island clients are always one worker (a rendered
        tree can't be split), so heavy work goes to a separate compute worker, and{' '}
        <code>workers</code> says how many: <code>1</code> to get it off the render thread,{' '}
        <code>N</code> when independent jobs should overlap. Press an export and watch which pulse
        freezes.
      </p>
      <MainHeartbeat />

      <h3 className="ops-row-title">A. anti-pattern: export computed INLINE on the render worker it shares with the pulse</h3>
      <div className="ops-row">
        <IslandPanel title="app: pulse (opsInline)" badge={pids.pulseInline}>
          <Island
            client={opsInline}
            framework="react"
            app="pulse"
            props={{ label: 'inline' }}
            mode={initialMode}
            onReady={ready('pulseInline')}
            onActivity={bump}
            className="island-root"
          />
        </IslandPanel>
        <IslandPanel title="app: export (opsInline)" badge={pids.exportInline}>
          <Island
            client={opsInline}
            framework="react"
            app="export"
            props={{ label: 'inline' }}
            mode={initialMode}
            onReady={ready('exportInline')}
            onActivity={bump}
            onEvent={(name, payload) => {
              const p = payload as { ms?: number; rows?: number };
              if (name === 'exported')
                setStatus(
                  `inline export: ${p.rows?.toLocaleString()} rows in ${p.ms}ms; the pulse on the same render worker was frozen the whole time`,
                );
            }}
            className="island-root"
          />
        </IslandPanel>
      </div>

      <h3 className="ops-row-title">B. fix: same two instances in ONE render worker, export offloaded (workers: 1)</h3>
      <div className="ops-row">
        <IslandPanel title="app: pulse (opsOffload)" badge={pids.pulseOffload}>
          <Island
            client={opsOffload}
            framework="react"
            app="pulse"
            props={{ label: 'offload' }}
            mode={initialMode}
            onReady={ready('pulseOffload')}
            onActivity={bump}
            className="island-root"
          />
        </IslandPanel>
        <IslandPanel title="app: export (opsOffload → compute.worker ×1)" badge={pids.exportOffload}>
          <Island
            client={opsOffload}
            framework="react"
            app="export"
            props={{ label: 'offload', offload: true }}
            mode={initialMode}
            onReady={ready('exportOffload')}
            onActivity={bump}
            onEvent={(name, payload) => {
              const p = payload as { ms?: number; rows?: number };
              if (name === 'exported')
                setStatus(
                  `offloaded export: ${p.rows?.toLocaleString()} rows in ${p.ms}ms on a dedicated compute worker; the pulse kept ticking`,
                );
            }}
            className="island-root"
          />
        </IslandPanel>
      </div>

      <h3 className="ops-row-title">C. nested: one render sub-worker for the cards, a compute pool for their work</h3>
      <IslandPanel
        title="app: regions (own worker → region.worker ×1, compute.worker pool ×3 + ×1)"
        badge={pids.regions}
      >
        <Island
          worker={consoleWorker}
          framework="react"
          workerOptions={{ doorbell: isolated }}
          app="regions"
          mode={initialMode}
          onReady={ready('regions')}
          onActivity={bump}
          onEvent={(name, payload) => {
            const p = payload as { regions?: string[]; wallMs?: number; workMs?: number; ms?: number; rows?: number };
            if (name === 'regionRecomputed')
              setStatus(
                p.regions?.length === 1
                  ? `${p.regions[0]} recomputed in ${p.wallMs}ms on the compute pool; every card kept ticking`
                  : `${p.regions?.length} regions recomputed in ${p.wallMs}ms wall (${p.workMs}ms of work) on a 3-worker pool`,
              );
            if (name === 'forecasted')
              setStatus(
                `forecast scored ${p.rows?.toLocaleString()} rows in ${p.ms}ms on a dedicated compute worker; cards kept ticking`,
              );
          }}
          className="island-root"
        />
      </IslandPanel>
    </>
  );
}

// Guarded so the module is import-safe in tests (they render <Shell/> directly).
const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<Shell />);
