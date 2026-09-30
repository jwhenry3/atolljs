<script lang="ts">
  /**
   * The Svelte islands demo — SVELTE RUNNING INSIDE WORKERS.
   *
   * Each island below mounts an app from `worker/svelte.worker.ts`'s
   * registry: real `.svelte` components (runes + {#each}) rendered by
   * Svelte's `mount()` against the proxy DOM. The worker bundle carries
   * Svelte; this page is just a thin host that replays its ops.
   *
   * What changes versus shell.tsx:
   *   - The shell itself is also Svelte — each island is a
   *     `<div use:island={{…}} />`; the action attaches, mounts the worker
   *     tree, and forwards `props` on every update.
   *   - `client` (not `worker:`) is passed so the doorbell choice travels
   *     with the connection; the two counters deliberately share ONE
   *     client so their islands live in the same OS worker.
   *   - Mediation is runes: worker emits write `$state` feeding the
   *     status line.
   *
   * The seven-island React demo lives in index.html / react-shell.html —
   * this page is the small framework-island edition from the docs.
   */
  import { island } from '@atolljs/svelte-island';
  import { connectIslandWorker } from '@atolljs/islands';
  import type { IslandHandle, Mode } from '@atolljs/islands';

  /** The registry worker — one script serving all Svelte apps. */
  const svelteWorker = (): Worker =>
    new Worker(new URL('../worker/svelte.worker.ts', import.meta.url), { type: 'module' });

  // SharedArrayBuffer only exists in cross-origin-isolated contexts — on
  // hosts without COOP/COEP the doorbell can't bind, so every island runs
  // its 50ms poll transport instead of push.
  const isolated =
    typeof SharedArrayBuffer !== 'undefined' &&
    (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated);
  const initialMode: Mode = isolated ? 'push' : 'poll';

  /**
   * Four clients = four OS workers running the same script. Unlike the
   * Vue/Solid/Angular demos, Svelte mounts get a client EACH: Svelte
   * schedules render work through ambient `document` resolution, so two
   * mounts sharing one worker can route ops to the wrong instance.
   */
  const counterClient = connectIslandWorker({ worker: svelteWorker, doorbell: isolated });
  const counter2Client = connectIslandWorker({ worker: svelteWorker, doorbell: isolated });
  const notesClient = connectIslandWorker({ worker: svelteWorker, doorbell: isolated });
  // The 1M-incidents benchmark gets its own worker — the whole point is
  // the heavy component never contends with (or blocks) anything else.
  const incidentsClient = connectIslandWorker({ worker: svelteWorker, doorbell: isolated });

  /* ── Mediation state — worker emits → $state → status line ── */

  let status = $state('mounting islands…');
  let mode = $state<Mode>(initialMode);
  let pids = $state<Record<string, string>>({});
  /** Bump counter — re-render trigger for the aggregate stats read. */
  let statsTick = $state(0);

  /** Every mounted island's handle — setMode + the aggregate stats read them. */
  const handles = new Map<string, IslandHandle>();

  const ready = (key: string) => (handle: IslandHandle): void => {
    handles.set(key, handle);
    handle.setMode(mode); // applies the user's pick to late-mounting islands
    pids = { ...pids, [key]: `worker ${handle.pid}` };
    statsTick++;
  };
  const bump = (): void => {
    statsTick++;
  };
  const setMode = (next: Mode): void => {
    mode = next;
    for (const handle of handles.values()) handle.setMode(next);
    bump();
  };
  const stats = $derived.by(() => {
    void statsTick; // tracked — recompute after every op batch
    const flushes = [...handles.values()].reduce((a, i) => a + i.flushCalls, 0);
    const ops = [...handles.values()].reduce((a, i) => a + i.opsApplied, 0);
    return `sync: ${mode} · flush calls: ${flushes} · ops applied: ${ops}`;
  });

  const counterOpts = (label: string, key: string, client: typeof counterClient) => ({
    client,
    app: 'counter',
    props: { label },
    onReady: ready(key),
    onActivity: bump,
    onEvent: (name: string, payload: unknown) => {
      const p = payload as { count?: number; label?: string };
      if (name === 'incremented')
        status = `${p.label} counter → ${p.count} (Svelte state stayed in the worker)`;
    },
  });
</script>

<h1>Svelte islands — Svelte in the worker</h1>
<p style="font: 12px monospace; color: #9aa4b2; margin-top: -8px">
  registry worker, one client per island — the worker bundle carries Svelte, the shell is a thin
  <code>use:island</code> host.
  <a href="./index.html" style="color: #7fb6ff">framework-free shell →</a>
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
      onclick={() => setMode(mode === 'push' ? 'poll' : 'push')}
    />
    push (SAB doorbell)
  </label>
  <span id="transport-stats">{stats}</span>
</div>
<div id="status-line">{status}</div>

<section class="island">
  <div class="island-head"><span>app: counter (Svelte mount())</span><span class="badge">{pids.counter ?? 'worker …'}</span></div>
  <div class="island-root" use:island={counterOpts('alpha', 'counter', counterClient)}></div>
</section>

<section class="island">
  <div class="island-head"><span>app: counter — second instance (own worker, same registry)</span><span class="badge">{pids.counter2 ?? 'worker …'}</span></div>
  <div class="island-root" use:island={counterOpts('beta', 'counter2', counter2Client)}></div>
</section>

<section class="island">
  <div class="island-head"><span>app: notes (registry app — own worker, same script)</span><span class="badge">{pids.notes ?? 'worker …'}</span></div>
  <div
    class="island-root"
    use:island={{
      client: notesClient,
      app: 'notes',
      props: { title: 'svelte island' },
      onReady: ready('notes'),
      onActivity: bump,
      onEvent: (name, payload) => {
        const p = payload as { text?: string; total?: number };
        if (name === 'noteAdded') status = `notes island emitted noteAdded → "${p.text}" (${p.total} total)`;
      },
    }}
  ></div>
</section>

<section class="island">
  <div class="island-head"><span>app: incidents — 1,000,000 rows, virtualized (own worker)</span><span class="badge">{pids.incidents ?? 'worker …'}</span></div>
  <div
    class="island-root"
    use:island={{
      client: incidentsClient,
      app: 'incidents',
      onReady: ready('incidents'),
      onActivity: bump,
      onEvent: (name, payload) => {
        const p = payload as { start?: number; end?: number; ms?: number };
        if (name === 'rendered') status = `incidents island rendered rows ${p.start?.toLocaleString()}–${p.end?.toLocaleString()} in ${p.ms?.toFixed(1)}ms (of 1,000,000)`;
      },
    }}
  ></div>
</section>
