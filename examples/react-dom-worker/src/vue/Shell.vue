<script setup lang="ts">
/**
 * The Vue islands demo — VUE RUNNING INSIDE WORKERS.
 *
 * Each island below mounts an app from `worker/vue.worker.ts`'s registry:
 * real `.vue` SFCs (script-setup + template) rendered by Vue's
 * createRenderer against the proxy DOM. The worker bundle carries Vue;
 * this page is just a thin host that replays its ops.
 *
 *   - `client` (not `worker:`) is passed so the doorbell choice travels
 *     with the connection; the two counters deliberately share ONE client
 *     so their islands live in the same OS worker ('counter@0' /
 *     'counter@1').
 *   - Mediation is reactive state: worker emits mutate `ref`s/`reactive()`
 *     that feed the status line.
 *   - Mount styles escalate: `<AtollIsland>` (counters), `islandComponent`
 *     (notes — plain attrs forward as the island's props), `lazyIsland` +
 *     a contract module (incidents — the island carries its own worker).
 *
 * The seven-island React demo lives in index.html / react-shell.html —
 * this page is the small framework-island edition from the consumer docs.
 */
import { reactive, ref } from 'vue';
import { AtollIsland, islandComponent, lazyIsland } from '@atolljs/vue-island';
import { connectIslandWorker } from '@atolljs/islands';
import type { IslandHandle, Mode } from '@atolljs/islands';

/** The registry worker — one script serving all Vue apps. */
const vueWorker = (): Worker =>
  new Worker(new URL('../worker/vue.worker.ts', import.meta.url), { type: 'module' });

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
const counterClient = connectIslandWorker({ worker: vueWorker, doorbell: isolated });
const notesClient = connectIslandWorker({ worker: vueWorker, doorbell: isolated });

/**
 * The facades — mount worker apps this shell never imports. Notes goes
 * through an eager proxy component (the string is the registry key);
 * incidents is lazy: a dynamic import + contract module that carries its
 * OWN worker, so the 1M-row benchmark can't contend with anything else
 * and its chunk only loads when the island mounts.
 */
const NotesIsland = islandComponent<{ title?: string }>('vue-notes');
const IncidentsIsland = lazyIsland(() => import('./incidents.island'));

const state = reactive({
  status: 'mounting islands…',
  mode: initialMode as Mode,
  pids: {} as Record<string, string>,
});
/** Every mounted island's handle — setMode + the aggregate stats read them. */
const handles = new Map<string, IslandHandle>();
/** Bump counter — re-render trigger for the aggregate stats read. */
const statsTick = ref(0);

const ready =
  (key: string) =>
  (handle: IslandHandle): void => {
    handles.set(key, handle);
    handle.setMode(state.mode); // applies the user's pick to late-mounting islands
    state.pids[key] = `worker ${handle.pid}`;
    statsTick.value++;
  };
const bump = (): void => {
  statsTick.value++;
};
const setMode = (mode: Mode): void => {
  state.mode = mode;
  for (const handle of handles.values()) handle.setMode(mode);
  bump();
};
const statsText = (): string => {
  void statsTick.value; // tracked read — stats text re-renders per op batch
  const flushes = [...handles.values()].reduce((a, i) => a + i.flushCalls, 0);
  const ops = [...handles.values()].reduce((a, i) => a + i.opsApplied, 0);
  return `sync: ${state.mode} · flush calls: ${flushes} · ops applied: ${ops}`;
};

const counterOpts = (label: string, key: string) => ({
  client: counterClient,
  app: 'counter',
  props: { label },
  onReady: ready(key),
  onActivity: bump,
  onEvent: (name: string, payload: unknown) => {
    const p = payload as { count?: number; label?: string };
    if (name === 'incremented')
      state.status = `${p.label} counter → ${p.count} (Vue state stayed in the worker)`;
  },
});

// Facade opts — every attribute that isn't a shell key forwards as the
// island's props, so `title` here reaches the worker app directly (no
// `props:` wrapper).
const notesOpts = {
  client: notesClient,
  title: 'vue island',
  onReady: ready('notes'),
  onActivity: bump,
  onEvent: (name: string, payload: unknown) => {
    const p = payload as { text?: string; total?: number };
    if (name === 'noteAdded')
      state.status = `notes island emitted noteAdded → "${p.text}" (${p.total} total)`;
  },
};

// The contract module supplies the worker — the shell only passes the
// doorbell choice (inside workerOptions) and the callbacks.
const incidentsOpts = {
  workerOptions: { doorbell: isolated },
  onReady: ready('incidents'),
  onActivity: bump,
  onEvent: (name: string, payload: unknown) => {
    const p = payload as { start?: number; end?: number; ms?: number };
    if (name === 'rendered')
      state.status = `incidents island rendered rows ${p.start?.toLocaleString()}–${p.end?.toLocaleString()} in ${p.ms?.toFixed(1)}ms (of 1,000,000)`;
  },
};
</script>

<template>
  <h1>Vue islands — Vue in the worker</h1>
  <p style="font: 12px monospace; color: #9aa4b2; margin-top: -8px">
    registry worker + shared client — the worker bundle carries Vue, the shell is a thin
    <code>&lt;AtollIsland/&gt;</code> + <code>islandComponent</code>/<code>lazyIsland</code> facade host.
    <a href="./index.html" style="color: #7fb6ff">framework-free shell →</a>
  </p>

  <div id="transport-bar">
    <span>transport:</span>
    <label
      id="transport-toggle"
      :title="isolated ? 'push via SharedArrayBuffer doorbell — off falls back to 50ms polling' : 'needs cross-origin isolation (no SharedArrayBuffer)'"
    >
      <input
        id="push-toggle"
        type="checkbox"
        :checked="state.mode === 'push'"
        :disabled="!isolated"
        @change="setMode(state.mode === 'push' ? 'poll' : 'push')"
      />
      push (SAB doorbell)
    </label>
    <span id="transport-stats">{{ statsText() }}</span>
  </div>
  <div id="status-line">{{ state.status }}</div>

  <section class="island">
    <div class="island-head">
      <span>app: counter (Vue createRenderer)</span>
      <span class="badge">{{ state.pids.counter ?? 'worker …' }}</span>
    </div>
    <AtollIsland v-bind="counterOpts('alpha', 'counter')" class="island-root" />
  </section>

  <section class="island">
    <div class="island-head">
      <span>app: counter — second instance (SAME worker as the first, one client)</span>
      <span class="badge">{{ state.pids.counter2 ?? 'worker …' }}</span>
    </div>
    <AtollIsland v-bind="counterOpts('beta', 'counter2')" class="island-root" />
  </section>

  <section class="island">
    <div class="island-head">
      <span>app: notes — islandComponent facade (attrs ARE the props)</span>
      <span class="badge">{{ state.pids.notes ?? 'worker …' }}</span>
    </div>
    <NotesIsland v-bind="notesOpts" class="island-root" />
  </section>

  <section class="island">
    <div class="island-head">
      <span>app: incidents — lazyIsland + contract module (own worker, 1M rows)</span>
      <span class="badge">{{ state.pids.incidents ?? 'worker …' }}</span>
    </div>
    <IncidentsIsland v-bind="incidentsOpts" class="island-root" />
  </section>
</template>
