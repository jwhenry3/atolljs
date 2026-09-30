/**
 * Poly-worker fixture covering the angularIslandApp edges the spectrum
 * fixture doesn't reach:
 *
 *   'svg'       — namespaced element creation (`<svg:*>`) and namespaced
 *                 attribute set/remove (`[attr.xlink:href]` toggling to null
 *                 exercises removeAttributeNS).
 *   'sanitize'  — `[innerHTML]` routes through the Sanitizer provider stub.
 *   'err'       — a listener that throws: INTERNAL_APPLICATION_ERROR_HANDLER
 *                 must surface it (console.error) instead of swallowing.
 *   'docbody'   — `(document:x)`/`(body:x)` host listeners resolve through
 *                 the proxy document/body targets in IslandRenderer.listen.
 *   'fallback'  — a NON-ENUMERABLE `input()` field the JIT interop scan
 *                 can't see → setProps' signal-node fallback write; plus an
 *                 undeclared prop name → the drop-and-warn path.
 *   'cfg'       — the `{ component, providers }` registry-entry form
 *                 (per-app injector extras).
 *   'sleepy'    — schedules a signal write on a timer; destroying the island
 *                 before it fires drives the scheduler tick into its
 *                 post-dispose guard (componentRef === null).
 *   'slotter'   — imperative app emitting a `data-atoll-slot` element: the
 *                 shell-side `slots` input/slotDelegate surface.
 *   'boomer'    — imperative app whose build throws on props.boom (mount and
 *                 updateProps error paths on the shell side).
 */
import '@angular/compiler';
import {
  Component,
  InjectionToken,
  inject,
  input,
  signal,
} from '@angular/core';
import { defineAngularPolyWorker } from '../../src/worker';

/* ── svg: namespaced elements + namespaced attributes ───────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-svg',
  // <svg:*> element syntax → IslandRenderer.createElement(ns, name);
  // [attr.xlink:href] → setAttributeNS/setAttribute with the 'xlink' token,
  // toggling null → removeAttributeNS.
  template: `
    <svg:svg class="chart" viewBox="0 0 10 10">
      <svg:circle class="dot" [attr.r]="r()" />
      <svg:a class="link" [attr.xlink:href]="href()"><svg:text class="cap">go</svg:text></svg:a>
    </svg:svg>
    <button class="unlink" (click)="clear()">unlink</button>
  `,
})
class SvgComponent {
  readonly r = signal(3);
  readonly href = signal<string | null>('#target');
  clear(): void {
    this.href.set(null);
  }
}

/* ── sanitize: [innerHTML] → Sanitizer provider ──────────────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-san',
  template: `<div class="san" [innerHTML]="html()"></div>
    <button class="swap" (click)="swap()">swap</button>`,
})
class SanComponent {
  readonly html = signal('<b class="bold">raw-a</b>');
  swap(): void {
    this.html.set('<i class="ital">raw-b</i>');
  }
}

/* ── err: a throwing listener → INTERNAL_APPLICATION_ERROR_HANDLER ───────── */

@Component({
  standalone: true,
  selector: 'atoll-err',
  template: `<button class="boom" (click)="explode()">boom</button>`,
})
class ErrComponent {
  explode(): void {
    throw new Error('listener exploded');
  }
}

/* ── docbody: (document:)/(body:) host listener targets ──────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-docbody',
  host: {
    '(document:custom-doc)': 'onDoc()',
    '(body:custom-body)': 'onBody()',
  },
  template: `<p class="hits">doc:{{ doc() }} body:{{ body() }}</p>`,
})
class DocBodyComponent {
  readonly doc = signal(0);
  readonly body = signal(0);
  onDoc(): void {
    this.doc.update((n) => n + 1);
  }
  onBody(): void {
    this.body.update((n) => n + 1);
  }
}

/* ── fallback: non-enumerable input() + undeclared prop names ────────────── */

@Component({
  standalone: true,
  selector: 'atoll-fallback',
  template: `<p class="extra">{{ extra() }}</p>`,
})
class FallbackComponent {
  /** An input() field the JIT interop's Object.keys scan cannot see — the
   *  setProps signal-node fallback is the only delivery path. */
  readonly extra!: ReturnType<typeof input<string>>;
  constructor() {
    Object.defineProperty(this, 'extra', {
      value: input<string>('dflt'),
      enumerable: false,
    });
  }
}

/* ── cfg: { component, providers } registry entry ────────────────────────── */

export const FLAVOR = new InjectionToken<string>('FLAVOR');

@Component({
  standalone: true,
  selector: 'atoll-cfg',
  template: `<p class="flavor">{{ flavor }}</p>`,
})
class CfgComponent {
  protected readonly flavor = inject(FLAVOR, { optional: true }) ?? 'vanilla';
}

/* ── sleepy: post-dispose scheduler notify guard ─────────────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-sleepy',
  template: `<p class="ticks">{{ ticks() }}</p>
    <button class="arm" (click)="arm()">arm</button>`,
})
class SleepyComponent {
  readonly ticks = signal(0);
  arm(): void {
    // The timer fires after the island is destroyed in the test — the
    // signal write still notifies the scheduler, whose queued tick finds
    // componentRef === null and returns.
    setTimeout(() => this.ticks.update((n) => n + 1), 25);
  }
}

export const extrasWorker = defineAngularPolyWorker({
  apps: {
    svg: SvgComponent,
    sanitize: SanComponent,
    err: ErrComponent,
    docbody: DocBodyComponent,
    fallback: FallbackComponent,
    // The { component, providers } entry form — per-app injector extras.
    cfg: { component: CfgComponent, providers: [{ provide: FLAVOR, useValue: 'mango' }] },
    sleepy: SleepyComponent,
  },
});
