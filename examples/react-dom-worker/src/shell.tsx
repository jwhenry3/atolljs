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
 * The seven-island demo lives in index.html — this page is the small
 * framework-island edition matching vue/solid/svelte/angular-shell.html.
 */
import { useRef, useState, Suspense } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Island, islandComponent, lazyIsland } from '@atolljs/react-island';
import { connectIslandWorker } from '@atolljs/islands';
import type { IslandHandle, Mode } from '@atolljs/islands';

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

/**
 * Two clients = two OS workers running the same script. The counters share
 * one client (one worker, two 'counter@N' instances); notes gets its own —
 * and the incidents benchmark carries a third worker through its contract
 * module below.
 */
const counterClient = connectIslandWorker({ worker: reactWorker, doorbell: isolated });
const notesClient = connectIslandWorker({ worker: reactWorker, doorbell: isolated });

/**
 * The facades — mount worker apps this shell never imports. Notes goes
 * through an eager proxy component (the string is the registry key);
 * incidents is lazy: a dynamic import + contract module that carries its
 * OWN worker, so the 1M-row benchmark can't contend with anything else
 * and its chunk only loads when the island mounts.
 */
const NotesIsland = islandComponent<{ title?: string }>('notes');
const IncidentsIsland = lazyIsland(() => import('./incidents.island'));

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
        <button
          id="push-btn"
          style={{ fontWeight: mode === 'push' ? 700 : 400 }}
          disabled={!isolated}
          title={isolated ? undefined : 'needs cross-origin isolation (no SharedArrayBuffer)'}
          onClick={() => setMode('push')}
        >
          push (SAB doorbell)
        </button>
        <button
          id="poll-btn"
          style={{ fontWeight: mode === 'poll' ? 700 : 400 }}
          onClick={() => setMode('poll')}
        >
          poll (50ms)
        </button>
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
        title="app: notes — islandComponent facade (attrs ARE the props)"
        badge={pids.notes}
      >
        <NotesIsland
          client={notesClient}
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
    </>
  );
}

// Guarded so the module is import-safe in tests (they render <Shell/> directly).
const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<Shell />);
