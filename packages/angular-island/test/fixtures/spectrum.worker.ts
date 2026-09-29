/**
 * Island worker entry for the Angular-renderer spectrum tests — several
 * standalone components exercising the realistic surface of
 * `angularIslandApp`, registered as a registry worker (`definePolyWorker`
 * `{apps}`) so one fixture serves every test: mount with `app: '<name>'`.
 *
 * `import '@angular/compiler'` installs the JIT facade — every component
 * here is decorator-authored, so `ɵcmp` compiles lazily. The shared
 * in-process module graph means the test file can read exported state
 * (`lifecycleLog`) that components write inside their hooks — that export
 * IS the assertion channel for ordering side effects the DOM can't show
 * (lifecycle order, afterRenderEffect runs).
 */
import '@angular/compiler';
import {
  Component,
  Injectable,
  InjectionToken,
  afterRenderEffect,
  inject,
  input,
  model,
  output,
  signal,
  type OnChanges,
  type OnDestroy,
  type OnInit,
  type SimpleChanges,
} from '@angular/core';
import { AsyncPipe, DatePipe, UpperCasePipe } from '@angular/common';
import { of } from 'rxjs';
import { definePolyWorker, emit } from '@atolljs/islands/worker';
import { angularIslandApp } from '../../src/worker';

/* ── 1. Control flow: @if/@else/@for/@empty/trackBy ─────────────────────── */

interface Row {
  id: number;
  label: string;
}

@Component({
  standalone: true,
  selector: 'atoll-flow',
  template: `
    <button class="toggle" (click)="toggle()">toggle</button>
    @if (shown()) {
      <p class="on">ON</p>
    } @else {
      <p class="off">OFF</p>
    }
    <button class="add" (click)="add()">add</button>
    <button class="reverse" (click)="reverse()">reverse</button>
    <button class="clear" (click)="clear()">clear</button>
    <ul class="rows">
      @for (row of rows(); track row.id) {
        <li class="row" [attr.data-id]="row.id">{{ row.label }}</li>
      } @empty {
        <li class="empty">empty</li>
      }
    </ul>
  `,
})
class FlowComponent {
  readonly shown = signal(true);
  readonly rows = signal<Row[]>([
    { id: 1, label: 'one' },
    { id: 2, label: 'two' },
    { id: 3, label: 'three' },
  ]);
  private nextId = 4;
  toggle(): void {
    this.shown.update((v) => !v);
  }
  add(): void {
    const id = this.nextId++;
    this.rows.update((rs) => [...rs, { id, label: `n${id}` }]);
  }
  reverse(): void {
    this.rows.update((rs) => [...rs].reverse());
  }
  clear(): void {
    this.rows.set([]);
  }
}

/* ── 2. Content projection: ng-content slots ────────────────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-slot-child',
  template: `
    <div class="head"><ng-content select="[slot-head]" /></div>
    <div class="body"><ng-content /></div>
  `,
})
class SlotChildComponent {}

@Component({
  standalone: true,
  selector: 'atoll-projection',
  imports: [SlotChildComponent],
  template: `
    <atoll-slot-child>
      <h1 slot-head class="title">{{ title() }}</h1>
      <p class="para" (click)="bump()">projected {{ n() }}</p>
    </atoll-slot-child>
  `,
})
class ProjectionComponent {
  readonly title = input('untitled');
  readonly n = signal(0);
  bump(): void {
    this.n.update((v) => v + 1);
  }
}

/* ── 3. DI: providedIn root + options.providers ─────────────────────────── */

@Injectable({ providedIn: 'root' })
class SharedStore {
  readonly count = signal(0);
  inc(): void {
    this.count.update((n) => n + 1);
  }
}

export const GREETING = new InjectionToken<string>('GREETING');

@Component({
  standalone: true,
  selector: 'atoll-di-child',
  template: `<button class="bump" (click)="store.inc()">bump</button>`,
})
class DiChildComponent {
  protected readonly store = inject(SharedStore);
}

@Component({
  standalone: true,
  selector: 'atoll-di',
  imports: [DiChildComponent],
  template: `
    <atoll-di-child />
    <p class="count">{{ store.count() }}</p>
    <p class="greeting">{{ greeting }}</p>
  `,
})
class DiComponent {
  protected readonly store = inject(SharedStore);
  protected readonly greeting = inject(GREETING, { optional: true }) ?? 'no greeting';
}

/* ── 4. Lifecycle hooks + afterRenderEffect ─────────────────────────────── */

/** Shared in-process assertion channel — the component pushes hook names. */
export const lifecycleLog: string[] = [];

@Component({
  standalone: true,
  selector: 'atoll-lifecycle',
  template: `<p class="greeting">{{ greeting() }}</p>`,
})
class LifecycleComponent implements OnInit, OnChanges, OnDestroy {
  readonly greeting = input('hi');
  constructor() {
    afterRenderEffect(() => {
      // Reading the input is the tracked dependency — a dep-less
      // afterRenderEffect correctly runs once and never re-fires.
      lifecycleLog.push(`afterRenderEffect:${this.greeting()}`);
    });
  }
  ngOnInit(): void {
    lifecycleLog.push('ngOnInit');
  }
  ngOnChanges(changes: SimpleChanges): void {
    lifecycleLog.push(`ngOnChanges:${Object.keys(changes).join(',')}`);
  }
  ngOnDestroy(): void {
    lifecycleLog.push('ngOnDestroy');
  }
}

/* ── 5. model() + output() two-way bindings ─────────────────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-two-way',
  template: `<button class="flip" (click)="flip()">{{ checked() ? 'on' : 'off' }}</button>`,
})
class TwoWayComponent {
  readonly checked = model(false);
  readonly flipped = output<boolean>();
  flip(): void {
    this.checked.update((v) => !v);
    // Component events stay worker-internal — the island→shell channel is
    // the islands `emit()` op, not output() (see the adapter docblock).
    this.flipped.emit(this.checked());
  }
}

@Component({
  standalone: true,
  selector: 'atoll-model',
  imports: [TwoWayComponent],
  template: `
    <p class="name">{{ name() }}</p>
    <p class="mirror">child: {{ childState() ? 'on' : 'off' }}</p>
    <atoll-two-way [(checked)]="childState" (flipped)="onFlip($event)" />
  `,
})
class ModelComponent {
  readonly name = model('anon');
  protected readonly childState = signal(false);
  protected readonly flips = signal(0);
  onFlip(v: boolean): void {
    this.flips.update((n) => n + 1);
    emit('flipped', { v, n: this.flips() });
  }
}

/* ── 6. Class/style/attr/property bindings ──────────────────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-bindings',
  template: `
    <div
      class="box"
      [class]="cls()"
      [class.active]="active()"
      [style]="styleObj()"
      [style.width.px]="w()"
      [style.opacity]="op()"
      [attr.data-state]="state()"
      [attr.aria-hidden]="'false'"
    ></div>
    <button class="activate" (click)="activate()">activate</button>
    <input class="flag" type="checkbox" [checked]="flag()" [disabled]="active()" />
    <input class="text" [value]="txt()" />
  `,
})
class BindingsComponent {
  readonly active = signal(false);
  readonly cls = signal('base dim');
  readonly styleObj = signal<Record<string, unknown>>({ color: 'red' });
  readonly w = signal(120);
  readonly op = signal(0.5);
  readonly state = signal('idle');
  readonly flag = signal(true);
  readonly txt = signal('typed');
  activate(): void {
    this.active.set(true);
    this.cls.set('base lit');
    // Style-map keys are raw property names — the `.px` suffix syntax only
    // exists on `[style.x.px]` bindings, not inside map objects.
    this.styleObj.set({ color: 'blue', 'font-size': '18px' });
    this.w.set(240);
    this.op.set(1);
    this.state.set('live');
    this.flag.set(false);
    this.txt.set('retyped');
  }
}

/* ── 7. Pipes ───────────────────────────────────────────────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-pipes',
  imports: [UpperCasePipe, DatePipe, AsyncPipe],
  template: `
    <p class="upper">{{ 'island' | uppercase }}</p>
    <p class="year">{{ ts | date: 'yyyy' }}</p>
    <p class="async">{{ later | async }}</p>
  `,
})
class PipesComponent {
  protected readonly ts = Date.UTC(2024, 5, 15, 12);
  protected readonly later = of('resolved');
}

/* ── 8. Host bindings ───────────────────────────────────────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-host-bind',
  host: {
    role: 'button',
    '(click)': 'press()',
    '(window:resize)': 'resized()',
    '[class.armed]': 'armed()',
    '[class.resized]': 'seen()',
    '[attr.aria-pressed]': 'armed()',
  },
  template: `<p class="state">{{ armed() ? 'armed' : 'safe' }}</p>`,
})
class HostBindComponent {
  readonly armed = signal(false);
  readonly seen = signal(false);
  press(): void {
    this.armed.update((v) => !v);
  }
  resized(): void {
    this.seen.set(true);
  }
}

/* ── 9. Async invalidation — signal writes outside a dispatch ───────────── */

@Component({
  standalone: true,
  selector: 'atoll-async',
  template: `
    <p class="ticks">{{ ticks() }}</p>
    <button class="schedule" (click)="schedule()">schedule</button>
  `,
})
class AsyncComponent implements OnDestroy {
  readonly ticks = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;
  schedule(): void {
    // A signal write outside any instance task — the adapter's
    // ChangeDetectionScheduler stub queues a microtask detectChanges whose
    // ops ride the doorbell/flush back like a listener-driven commit.
    this.timer = setInterval(() => {
      this.ticks.update((n) => {
        if (n >= 2 && this.timer !== null) {
          clearInterval(this.timer);
          this.timer = null;
        }
        return n + 1;
      });
    }, 0);
  }
  ngOnDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }
}

/* ── 10. @defer probe ───────────────────────────────────────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-defer',
  template: `
    @defer (on immediate) {
      <p class="deferred">deferred</p>
    } @placeholder {
      <p class="ph">placeholder</p>
    }
  `,
})
class DeferComponent {}

/* ── Registry ───────────────────────────────────────────────────────────── */

export const spectrumWorker = definePolyWorker({
  apps: {
    flow: angularIslandApp(FlowComponent),
    projection: angularIslandApp(ProjectionComponent),
    di: angularIslandApp(DiComponent, {
      providers: [{ provide: GREETING, useValue: 'hola island' }],
    }),
    lifecycle: angularIslandApp(LifecycleComponent),
    model: angularIslandApp(ModelComponent),
    bindings: angularIslandApp(BindingsComponent),
    pipes: angularIslandApp(PipesComponent),
    hostBind: angularIslandApp(HostBindComponent),
    async: angularIslandApp(AsyncComponent),
    defer: angularIslandApp(DeferComponent),
  },
});
