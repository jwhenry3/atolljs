/**
 * The Solid islands demo — SOLID RUNNING INSIDE WORKERS.
 *
 * Each island below mounts an app from `worker/solid.worker.ts`'s
 * registry: plain-function Solid components (createSignal + h()/insert,
 * generate:'universal') rendered by Solid's universal renderer against
 * the proxy DOM. The worker bundle carries Solid; this page is just a
 * thin host that replays its ops.
 *
 * What changes versus shell.tsx:
 *   - The shell itself is also Solid — `solid-js/html` tagged templates
 *     produce real DOM with reactive inserts; `Island()` returns the host
 *     element itself.
 *   - `client` (not `worker:`) is passed so the doorbell choice travels
 *     with the connection; the two counters deliberately share ONE client
 *     so their islands live in the same OS worker ('counter@0' / 'counter@1').
 *   - Mediation is signals: worker emits write setters that feed the
 *     status line; island `props` can be an accessor the binding tracks.
 *
 * The seven-island React demo lives in index.html / react-shell.html —
 * this page is the small framework-island edition from the consumer docs.
 */
import { createRoot, createSignal } from 'solid-js';
import html from 'solid-js/html';
import { Island } from '@atolljs/solid-island';
import { connectIslandWorker } from '@atolljs/islands';
import type { IslandHandle, Mode } from '@atolljs/islands';

/** The registry worker — one script serving all Solid apps. */
const solidWorker = (): Worker =>
  new Worker(new URL('./worker/solid.worker.ts', import.meta.url), { type: 'module' });

// SharedArrayBuffer only exists in cross-origin-isolated contexts — on
// hosts without COOP/COEP (GitHub Pages where coi-sw.js didn't take, or a
// browser without `credentialless`) the doorbell can't bind, so every
// island runs its 50ms poll transport instead of push.
const isolated =
  typeof SharedArrayBuffer !== 'undefined' &&
  (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated);
const initialMode: Mode = isolated ? 'push' : 'poll';

/**
 * Three clients = three OS workers running the same script. The counters
 * share one client (one worker, two 'counter@N' instances); notes and the
 * incidents benchmark each get their own.
 */
const counterClient = connectIslandWorker({ worker: solidWorker, doorbell: isolated });
const notesClient = connectIslandWorker({ worker: solidWorker, doorbell: isolated });
// The 1M-incidents benchmark gets its own worker — the whole point is the
// heavy component never contends with (or blocks) anything else.
const incidentsClient = connectIslandWorker({ worker: solidWorker, doorbell: isolated });

/* ── Shell ──────────────────────────────────────────────────────────────── */

const rootEl = document.getElementById('root');
if (rootEl) {
  // One owner for every signal/effect/island — Solid islands dispose with
  // their owner, so the whole page tears down cleanly as a unit.
  createRoot(() => {
    const [status, setStatus] = createSignal('mounting islands…');
    const [mode, setModeState] = createSignal<Mode>(initialMode);
    const [pids, setPids] = createSignal<Record<string, string>>({});
    /** Bump counter — re-render trigger for the aggregate stats read. */
    const [statsTick, setStatsTick] = createSignal(0);
    const bump = (): void => {
      setStatsTick((t) => t + 1);
    };

    /** Every mounted island's handle — setMode + the aggregate stats read them. */
    const handles = new Map<string, IslandHandle>();

    const ready =
      (key: string) =>
      (handle: IslandHandle): void => {
        handles.set(key, handle);
        handle.setMode(mode()); // applies the user's pick to late-mounting islands
        setPids((p) => ({ ...p, [key]: `worker ${handle.pid}` }));
        bump();
      };
    const setMode = (next: Mode): void => {
      setModeState(next);
      for (const handle of handles.values()) handle.setMode(next);
      bump();
    };

    /** One island panel — head + the `Island()` host element. */
    const panel = (title: string, badge: () => string | undefined, el: HTMLElement): Node =>
      html`<section class="island">
        <div class="island-head"><span>${title}</span><span class="badge">${badge}</span></div>
        ${el}
      </section>` as Node;

    const island = (opts: Parameters<typeof Island>[0]): HTMLElement => {
      const el = Island(opts);
      el.className = 'island-root';
      return el;
    };

    const counter = (label: string, key: string): HTMLElement =>
      island({
        client: counterClient,
        app: 'counter',
        props: { label },
        onReady: ready(key),
        onActivity: bump,
        onEvent: (name, payload) => {
          const p = payload as { count?: number; label?: string };
          if (name === 'incremented')
            setStatus(`${p.label} counter → ${p.count} (Solid state stayed in the worker)`);
        },
      });

    const transportBar = html`<div id="transport-bar">
      <span>transport:</span>
      <button
        id="push-btn"
        style=${() => `font-weight: ${mode() === 'push' ? 700 : 400}`}
        title=${isolated ? '' : 'needs cross-origin isolation (no SharedArrayBuffer)'}
        onClick=${() => setMode('push')}
      >push (SAB doorbell)</button>
      <button
        id="poll-btn"
        style=${() => `font-weight: ${mode() === 'poll' ? 700 : 400}`}
        onClick=${() => setMode('poll')}
      >poll (50ms)</button>
      <span id="transport-stats">${() => {
        statsTick(); // tracked — recompute after every op batch
        const flushes = [...handles.values()].reduce((a, i) => a + i.flushCalls, 0);
        const ops = [...handles.values()].reduce((a, i) => a + i.opsApplied, 0);
        return `sync: ${mode()} · flush calls: ${flushes} · ops applied: ${ops}`;
      }}</span>
    </div>` as HTMLElement;
    (transportBar.querySelector('#push-btn') as HTMLButtonElement).disabled = !isolated;

    rootEl.append(
      html`<h1>Solid islands — Solid in the worker</h1>` as Node,
      html`<p style="font: 12px monospace; color: #9aa4b2; margin-top: -8px">
        registry worker + shared client — the worker bundle carries Solid, the shell is a thin
        <code>Island()</code> host (<code>solid-js/html</code> templates).
        <a href="./index.html" style="color: #7fb6ff">framework-free shell →</a>
      </p>` as Node,
      transportBar,
      html`<div id="status-line">${status}</div>` as Node,

      panel(
        'app: counter (Solid universal renderer)',
        () => pids().counter,
        counter('alpha', 'counter'),
      ),

      panel(
        'app: counter — second instance (SAME worker as the first, one client)',
        () => pids().counter2,
        counter('beta', 'counter2'),
      ),

      panel(
        'app: notes (registry app — own worker, same script)',
        () => pids().notes,
        island({
          client: notesClient,
          app: 'notes',
          props: { title: 'solid island' },
          onReady: ready('notes'),
          onActivity: bump,
          onEvent: (name, payload) => {
            const p = payload as { text?: string; total?: number };
            if (name === 'noteAdded')
              setStatus(`notes island emitted noteAdded → "${p.text}" (${p.total} total)`);
          },
        }),
      ),

      panel(
        'app: incidents — 1,000,000 rows, virtualized (own worker)',
        () => pids().incidents,
        island({
          client: incidentsClient,
          app: 'incidents',
          onReady: ready('incidents'),
          onActivity: bump,
          onEvent: (name, payload) => {
            const p = payload as { start?: number; end?: number; ms?: number };
            if (name === 'rendered')
              setStatus(`incidents island rendered rows ${p.start?.toLocaleString()}–${p.end?.toLocaleString()} in ${p.ms?.toFixed(1)}ms (of 1,000,000)`);
          },
        }),
      ),
    );
  });
}
