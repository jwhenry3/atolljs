/**
 * 'checkout' worker entry — the Angular micro-frontend, one app per
 * worker. JIT + zoneless: '@angular/compiler' ships in the worker bundle
 * to compile the decorator template; the adapter's output() bridge routes
 * `paid.emit(...)` onto the island's event channel — and the contract
 * parses the payload before it leaves the worker.
 */
import '@angular/compiler';
import { Component, input, output } from '@angular/core';
import { defineAngularMonoWorker } from '@atolljs/angular-island/worker';
import checkoutContract from '../contracts/checkout.contract';

// The contract is checked against this component's input()/output()
// surface: IslandContract<IslandInputs<C>, IslandEvents<C>> — a contract
// missing 'total' or 'paid' fails typecheck HERE, not at the shell.
@Component({
  selector: 'mfe-checkout',
  template: `
    <div class="mfe-card">
      <span class="mfe-heading">{{ label() }}: \${{ total() }}</span>
      <button class="mfe-btn" (click)="pay()">pay</button>
    </div>
  `,
})
export class CheckoutComponent {
  readonly label = input('checkout');
  readonly total = input(0);
  readonly paid = output<{ total: number }>();
  pay(): void {
    this.paid.emit({ total: this.total() });
  }
}

export const checkoutWorker = defineAngularMonoWorker(CheckoutComponent, {
  contract: checkoutContract,
});
