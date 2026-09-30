/**
 * The Angular islands demo — ANGULAR RUNNING INSIDE WORKERS.
 *
 * Each island below mounts an `@AngularIsland` component from
 * `worker/angular.worker.ts`'s decorator registry: standalone @Component
 * classes (signal inputs + (click) bindings + output() events) rendered
 * against the proxy DOM. The worker bundle carries Angular; this page is
 * a thin host that replays its ops.
 *
 * What changes versus shell.tsx:
 *   - The shell itself is also Angular — each island is a generated
 *     `islandComponent` facade (`<counter-island [props]/>`), typed
 *     against the WORKER component's class via `import type`: props come
 *     from its input() fields, events from its output() fields, and no
 *     worker code reaches this bundle.
 *   - `client`/`worker` are baked into the facade — the two counters
 *     deliberately share ONE client so they live in the same OS worker;
 *     notes/incidents use the `worker` shorthand (one worker each).
 *   - JIT + zoneless: `import '@angular/compiler'` compiles decorator
 *     templates at runtime, `provideZonelessChangeDetection` schedules
 *     change detection off signal writes — no zone.js.
 *
 * The seven-island React demo lives in index.html / react-shell.html —
 * this page is the small framework-island edition from the consumer docs.
 */
// The JIT compiler — required for @Component templates at runtime.
import '@angular/compiler';
import { Component, computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  islandComponent,
  type IslandEventHandler,
  type IslandInputs,
} from '@atolljs/angular-island';
import { connectIslandWorker } from '@atolljs/islands';
import type { IslandHandle, Mode } from '@atolljs/islands';
// import type — the component classes carry the props/events contract; the
// worker module (and the Angular bundle it pulls) never enters this chunk.
import type {
  CounterComponent,
  IncidentsComponent,
  NotesComponent,
} from './worker/angular.worker';

/** The registry worker — one script serving all Angular apps. */
const angularWorker = (): Worker =>
  new Worker(new URL('./worker/angular.worker.ts', import.meta.url), { type: 'module' });

// SharedArrayBuffer only exists in cross-origin-isolated contexts — on
// hosts without COOP/COEP (GitHub Pages where coi-sw.js didn't take, or a
// browser without `credentialless`) the doorbell can't bind, so every
// island runs its 50ms poll transport instead of push.
const isolated =
  typeof SharedArrayBuffer !== 'undefined' &&
  (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated);
const initialMode: Mode = isolated ? 'push' : 'poll';

/* ── Island facades ───────────────────────────────────────────────────────
 * `islandComponent<C>` generates a standalone component whose inputs are
 * the island surface: [props] types as IslandInputs<C> (the worker
 * component's input()/model() fields), onEvent as IslandEventHandler<C>
 * (its output()/model() fields). `app`/`client`/`worker` bake in as
 * defaults — the template call sites below carry only per-instance data.
 */
const counterClient = connectIslandWorker({ worker: angularWorker, doorbell: isolated });

const CounterIsland = islandComponent<CounterComponent>({
  app: 'counter',
  // Both <counter-island> mounts share this client — two 'counter@N'
  // instances in ONE OS worker.
  client: counterClient,
  selector: 'counter-island',
});
const NotesIsland = islandComponent<NotesComponent>({
  app: 'notes',
  worker: angularWorker, // shorthand — the facade owns its worker
  selector: 'notes-island',
});
const IncidentsIsland = islandComponent<IncidentsComponent>({
  app: 'incidents',
  // The 1M-row benchmark gets a dedicated worker — the whole point is the
  // heavy component never contends with anything else.
  worker: angularWorker,
  selector: 'incidents-island',
});

/* ── Shell ──────────────────────────────────────────────────────────────── */

@Component({
  selector: 'atoll-shell',
  standalone: true,
  imports: [CounterIsland, NotesIsland, IncidentsIsland],
  template: `
    <h1>Angular islands — Angular in the worker</h1>
    <p style="font: 12px monospace; color: #9aa4b2; margin-top: -8px">
      decorated worker components + generated facade components — props and
      events are typed off the worker classes' own input()/output() fields.
      <a href="./index.html" style="color: #7fb6ff">framework-free shell →</a>
    </p>

    <div id="transport-bar">
      <span>transport:</span>
      <button
        id="push-btn"
        [style.font-weight]="mode() === 'push' ? 700 : 400"
        [disabled]="!isolated"
        [title]="isolated ? '' : 'needs cross-origin isolation (no SharedArrayBuffer)'"
        (click)="mode.set('push')"
      >push (SAB doorbell)</button>
      <button
        id="poll-btn"
        [style.font-weight]="mode() === 'poll' ? 700 : 400"
        (click)="mode.set('poll')"
      >poll (50ms)</button>
      <span id="transport-stats">{{ stats() }}</span>
    </div>
    <div id="status-line">{{ status() }}</div>

    <section class="island">
      <div class="island-head"><span>counter-island (Angular bootstrap)</span><span class="badge">{{ pids()['counter'] ?? 'worker …' }}</span></div>
      <counter-island
        class="island-root"
        [props]="alphaProps"
        [mode]="mode()"
        [onReady]="onReady('counter')"
        [onActivity]="bump"
        [onEvent]="onCounterEvent"
      />
    </section>

    <section class="island">
      <div class="island-head"><span>counter-island — second instance (SAME worker as the first, one client)</span><span class="badge">{{ pids()['counter2'] ?? 'worker …' }}</span></div>
      <counter-island
        class="island-root"
        [props]="betaProps"
        [mode]="mode()"
        [onReady]="onReady('counter2')"
        [onActivity]="bump"
        [onEvent]="onCounterEvent"
      />
    </section>

    <section class="island">
      <div class="island-head"><span>notes-island (own worker, same script)</span><span class="badge">{{ pids()['notes'] ?? 'worker …' }}</span></div>
      <notes-island
        class="island-root"
        [props]="notesProps"
        [mode]="mode()"
        [onReady]="onReady('notes')"
        [onActivity]="bump"
        [onEvent]="onNotesEvent"
      />
    </section>

    <section class="island">
      <div class="island-head"><span>incidents-island — 1,000,000 rows, virtualized (own worker)</span><span class="badge">{{ pids()['incidents'] ?? 'worker …' }}</span></div>
      <incidents-island
        class="island-root"
        [mode]="mode()"
        [onReady]="onReady('incidents')"
        [onActivity]="bump"
        [onEvent]="onIncidentsEvent"
      />
    </section>
  `,
})
class ShellComponent {
  readonly isolated = isolated;

  /* Props typed off the worker components' input() fields. */
  readonly alphaProps: IslandInputs<CounterComponent> = { label: 'alpha' };
  readonly betaProps: IslandInputs<CounterComponent> = { label: 'beta' };
  readonly notesProps: IslandInputs<NotesComponent> = { title: 'angular island' };

  /* Mediation state — worker emits → signals → template bindings. */
  readonly status = signal('mounting islands…');
  readonly mode = signal<Mode>(initialMode);
  readonly pids = signal<Record<string, string>>({});
  /** Bump counter — CD trigger for the aggregate stats read. */
  readonly statsTick = signal(0);

  /** Every mounted island's handle — the aggregate stats read them. */
  private readonly handles = new Map<string, IslandHandle>();

  readonly stats = computed(() => {
    this.statsTick(); // tracked — recompute after every op batch
    const flushes = [...this.handles.values()].reduce((a, i) => a + i.flushCalls, 0);
    const ops = [...this.handles.values()].reduce((a, i) => a + i.opsApplied, 0);
    return `sync: ${this.mode()} · flush calls: ${flushes} · ops applied: ${ops}`;
  });

  readonly bump = (): void => {
    this.statsTick.update((t) => t + 1);
  };

  readonly onReady = (key: string) => (handle: IslandHandle): void => {
    this.handles.set(key, handle);
    this.pids.update((p) => ({ ...p, [key]: `worker ${handle.pid}` }));
    this.bump();
  };

  /* Event handlers typed off the worker components' output()/model()
   * fields — 'incremented' narrows payload to { count, label }. */
  readonly onCounterEvent: IslandEventHandler<CounterComponent> = (name, payload) => {
    if (name === 'incremented')
      this.status.set(`${payload.label} counter → ${payload.count} (Angular state stayed in the worker)`);
  };

  readonly onNotesEvent: IslandEventHandler<NotesComponent> = (name, payload) => {
    if (name === 'noteAdded')
      this.status.set(`notes island emitted noteAdded → "${payload.text}" (${payload.total} total)`);
  };

  readonly onIncidentsEvent: IslandEventHandler<IncidentsComponent> = (name, payload) => {
    if (name === 'rendered')
      this.status.set(`incidents island rendered rows ${payload.start.toLocaleString()}–${payload.end.toLocaleString()} in ${payload.ms.toFixed(1)}ms (of 1,000,000)`);
  };
}

const rootEl = document.getElementById('root');
if (rootEl) {
  const host = document.createElement('atoll-shell');
  rootEl.appendChild(host);
  void bootstrapApplication(ShellComponent, {
    providers: [provideZonelessChangeDetection()],
  });
}
