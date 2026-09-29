/**
 * AOT-shaped island worker entry — a component whose `ɵcmp` is a STATIC,
 * hand-authored `ɵɵdefineComponent` (the same shape ngc emits into a
 * `.component.js` next to its source). No `@Component` decorator, no
 * `import '@angular/compiler'`: `getComponentDef` returns the static def
 * directly, so mounting never touches the JIT facade. This is the path a
 * real Angular-built island takes — ngc-compiled worker entries already
 * carry `static ɵcmp`/`static ɵfac`.
 *
 * Template (what it would be as a decorator component):
 *   <button class="inc" [disabled]="locked" (click)="inc()">{{ label }}: {{ n }}</button>
 *   <p class="val">{{ n }}</p>
 */
import {
  ɵɵdefineComponent,
  ɵɵlistener,
  ɵɵproperty,
  ɵɵtextInterpolate1,
  ɵɵtextInterpolate2,
  ɵɵadvance,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵtext,
  type Type,
} from '@angular/core';
import { definePolyWorker } from '@jwhenry123/mesh-islands/worker';
import { angularIslandApp } from '../../src/worker';

class AotComponent {
  /** Declared input — `inputs: {label: 'label'}` on the def. */
  label = 'aot';
  locked = false;
  n = 0;
  inc(): void {
    this.n++;
  }

  /** The factory Angular instantiates the class through (NG_FACTORY_DEF). */
  static ɵfac = (t?: unknown): AotComponent =>
    new ((t as Type<AotComponent>) ?? AotComponent)();

  static ɵcmp = ɵɵdefineComponent({
    type: AotComponent,
    selectors: [['mesh-aot']],
    standalone: true,
    inputs: { label: 'label' },
    decls: 4,
    // binding slots: property(1) + interpolate2(2 — one per expression) +
    // interpolate1(1). Under-declaring trips "Slot should have been
    // initialized to NO_CHANGE" in dev mode.
    vars: 4,
    consts: [
      ['class', 'inc'],
      ['class', 'val'],
    ],
    template: function AotComponent_Template(rf: number, ctx: AotComponent): void {
      if (rf & 1) {
        ɵɵelementStart(0, 'button', 0);
        ɵɵlistener('click', function AotComponent_Template_button_click_listener() {
          return ctx.inc();
        });
        ɵɵtext(1);
        ɵɵelementEnd();
        ɵɵelementStart(2, 'p', 1);
        ɵɵtext(3);
        ɵɵelementEnd();
      }
      if (rf & 2) {
        ɵɵproperty('disabled', ctx.locked);
        ɵɵadvance();
        ɵɵtextInterpolate2('', ctx.label, ': ', ctx.n, '');
        ɵɵadvance(2);
        ɵɵtextInterpolate1('', ctx.n, '');
      }
    },
    encapsulation: 2,
  });
}

export const aotWorker = definePolyWorker({
  apps: { aot: angularIslandApp(AotComponent) },
});
