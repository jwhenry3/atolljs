/**
 * Island worker entry for the Angular-renderer tests — a standalone
 * `CounterComponent` rendered into the realm's proxy document by
 * `angularIslandApp`, registered as a realm worker (single app → 'main').
 *
 * `import '@angular/compiler'` installs the JIT facade the @Component
 * decorator's lazy `ɵcmp` resolves against — required because vitest compiles
 * decorators, not AOT.
 */
import '@angular/compiler';
import { Component, input, signal } from '@angular/core';
import { defineRealmWorker, emit } from '@jwhenry123/mesh-worker-dom/worker';
import { angularIslandApp } from '../../src/worker';

@Component({
  standalone: true,
  selector: 'mesh-counter',
  template: `
    <p class="label">{{ label() }}</p>
    <button class="inc" (click)="increment()">increment</button>
    <p class="count">{{ count() }}</p>
  `,
})
class CounterComponent {
  readonly label = input('counter');
  readonly count = signal(0);
  increment(): void {
    this.count.update((n) => n + 1);
    emit('incremented', { n: this.count() });
  }
}

export const counterWorker = defineRealmWorker(angularIslandApp(CounterComponent));
