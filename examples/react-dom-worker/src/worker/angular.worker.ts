/**
 * Angular island worker — a registry worker serving JIT decorator
 * components. Each island is a standalone `@Component` marked with
 * `@AngularIsland`: the decorator stamps the registry name (derived from
 * the class name — `CounterComponent` → 'counter') and registers the class
 * so `defineAngularPolyWorker()` collects the whole set with no `apps` map.
 *
 * The component's own signal API IS the island contract:
 *  - `input()`/`model()` fields are the props the shell's `[props]` sends;
 *  - `output()`/`model()` fields bridge onto the island's emit channel —
 *    `incremented.emit(n)` reaches the shell as onEvent('incremented', n),
 *    no manual `emit()` (or instance re-entry bookkeeping) required.
 *
 * `import '@angular/compiler'` is required — vite doesn't AOT-compile this
 * example, so the JIT compiler must ship in the worker bundle. Zoneless
 * change detection is the default in the island bootstrap.
 */
import '@angular/compiler';
import { Component, computed, input, output, signal, afterEveryRender } from '@angular/core';
import { AngularIsland, defineAngularPolyWorker } from '@atolljs/angular-island/worker';

/**
 * 'counter' — the docs' canonical Angular island: a `label` signal input,
 * a `signal` count, a `(click)` binding, and an 'incremented' OUTPUT for
 * the shell's status line — the declared output is the island's event.
 *
 * NOTE: pass the registry key explicitly — `@AngularIsland` bare derives
 * it from the class name, which minification mangles in production builds.
 */
@AngularIsland('counter')
@Component({
  selector: 'demo-counter',
  template: `
    <div class="angular-counter">
      <span class="vanilla-heading">{{ label() }}: {{ count() }}</span>
      <button class="mw-btn" (click)="increment()">increment</button>
    </div>
  `,
})
export class CounterComponent {
  readonly label = input('count');
  readonly count = signal(0);
  readonly incremented = output<{ count: number; label: string }>();
  increment(): void {
    const n = this.count() + 1;
    this.count.set(n);
    this.incremented.emit({ count: n, label: this.label() });
  }
}

/**
 * 'notes' — the notes composer from the Vue demo, Angular-style: a list
 * `signal` rendered through `@for`, an `(input)` handler reading the wire
 * payload's stamped `value`, and a 'noteAdded' emit on each add.
 */
@AngularIsland('notes')
@Component({
  selector: 'demo-notes',
  template: `
    <div class="angular-notes">
      <h3 class="vanilla-heading">{{ title() }}</h3>
      <div class="atoll-map-places">
        <input
          placeholder="write a note…"
          [value]="draft()"
          (input)="onDraft($event)"
          (keydown.enter)="add()"
        />
        <button class="atoll-map-place-btn" (click)="add()">add</button>
      </div>
      <ul class="vanilla-log">
        @for (n of notes(); track $index) {
          <li class="vanilla-log-line">{{ n }}</li>
        }
      </ul>
      <div class="vanilla-readout">{{ notes().length }} note(s) — state lives in the worker</div>
    </div>
  `,
})
export class NotesComponent {
  readonly title = input('angular island');
  readonly draft = signal('');
  readonly notes = signal<string[]>([]);
  readonly noteAdded = output<{ text: string; total: number }>();
  onDraft(event: Event): void {
    // The wire payload's `value` is stamped onto the wrapped target.
    this.draft.set((event.target as HTMLInputElement).value);
  }
  add(): void {
    const text = this.draft().trim();
    if (text === '') return;
    this.notes.update((xs) => [...xs, text]);
    this.draft.set('');
    this.noteAdded.emit({ text, total: this.notes().length });
  }
}

/**
 * 'incidents' — the heavy-component benchmark: 1,000,000 incident records
 * in the worker, rendered through a virtualized scroller. The main thread
 * only ever sees ~20 rows of ops no matter how deep the user scrolls.
 * Rows are lazily generated; each scroll event re-reads the window and a
 * 'rendered' emit reports the re-render time back to the shell.
 */
const REGIONS = ['us-east', 'us-west', 'eu-central', 'ap-south', 'sa-east'];
const SEVS = ['P1', 'P2', 'P3', 'P4'];
const ROW_H = 24;
const OV = 4;
const VISIBLE = Math.ceil(320 / ROW_H) + OV * 2;
const incident = (i: number) => ({
  id: i,
  site: `site-${(i * 7919) % 1409}`,
  region: REGIONS[i % REGIONS.length],
  sev: (i * 31) % 100,
  dur: `${((i * 104729) % 977) % 60}m`,
});

interface Incident {
  id: number;
  site: string;
  region: string;
  sev: number;
  dur: string;
}

@AngularIsland('incidents')
@Component({
  selector: 'demo-incidents',
  template: `
    <div class="incidents">
      <div class="inc-stats">
        {{ fmt(count()) }} incidents · rows {{ fmt(first()) }}–{{ fmt(end()) }} ·
        worker re-render {{ lastMs().toFixed(1) }}ms
      </div>
      <div class="inc-viewport" (scroll)="onScroll($event)">
        <div class="inc-spacer" [style.height.px]="count() * ROW_H">
          @for (r of rows(); track r.id) {
            <div class="inc-row" [style.top.px]="r.id * ROW_H">
              <span class="inc-id">#{{ r.id }}</span>
              <span class="inc-site">{{ r.site }}</span>
              <span class="inc-region">{{ r.region }}</span>
              <span [class]="sevClass(r.sev)">{{ sevLabel(r.sev) }} · {{ r.sev }}</span>
              <span class="inc-dur">{{ r.dur }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class IncidentsComponent {
  readonly ROW_H = ROW_H;
  readonly count = input(1_000_000);
  readonly start = signal(0);
  readonly lastMs = signal(0);
  readonly rendered = output<{ start: number; end: number; ms: number }>();
  private t0 = performance.now();

  readonly first = computed(() =>
    Math.min(this.start(), Math.max(0, this.count() - VISIBLE)),
  );
  readonly rows = computed<Incident[]>(() =>
    Array.from({ length: Math.min(VISIBLE, this.count() - this.first()) }, (_, k) =>
      incident(this.first() + k),
    ),
  );
  readonly end = computed(() => this.first() + this.rows().length - 1);

  // Zoneless CD renders async — afterEveryRender fires after the commit,
  // when the dispatch's instance scope is already released. The adapter's
  // output bridge re-enters the instance for each emit, so the component
  // needs no getActiveInstance/runInInstance bookkeeping of its own. The
  // window-key guard stops lastMs's own write from looping into a report.
  private prevKey = '';
  constructor() {
    afterEveryRender(() => {
      const key = `${this.first()}:${this.end()}`;
      if (key === this.prevKey) return;
      this.prevKey = key;
      const ms = performance.now() - this.t0;
      this.lastMs.set(ms);
      this.rendered.emit({ start: this.first(), end: this.end(), ms });
    });
  }

  fmt(n: number): string {
    return n.toLocaleString();
  }
  sevClass(s: number): string {
    return `inc-sev sev-p${s > 75 ? 1 : s > 40 ? 2 : s > 15 ? 3 : 4}`;
  }
  sevLabel(s: number): string {
    return SEVS[s > 75 ? 0 : s > 40 ? 1 : s > 15 ? 2 : 3];
  }
  onScroll(event: Event): void {
    this.t0 = performance.now();
    // The driver stamps the scroller's scrollTop onto the wire payload —
    // the proxy element's geometry getters are stubs.
    const st = (event as Event & { scrollTop?: number }).scrollTop ?? 0;
    this.start.set(Math.max(0, Math.floor(st / ROW_H) - OV));
  }
}

// No apps map — `defineAngularPolyWorker()` collects every @AngularIsland
// component in the module graph ('counter', 'notes', 'incidents').
export const angularWorker = defineAngularPolyWorker();
