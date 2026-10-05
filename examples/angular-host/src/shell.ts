/**
 * Angular host — FIVE worker-rendered micro-frontends, five frameworks.
 *
 * The shell imports only CONTRACT modules (`../../mfe/contracts/*`):
 * `islandComponent({ contract })` generates a standalone component whose
 * [props] input types off the contract's prop schema and [onEvent] narrows
 * to its declared events — no worker component class ever enters this
 * bundle. The contract's `worker` field supplies the connection, so the
 * facades are zero-config beyond a selector.
 *
 * JIT + zoneless on the SHELL too here (`import '@angular/compiler'`
 * compiles this page's own decorator component; the generated island
 * facades themselves are AOT-safe ɵɵdefineComponent classes).
 *
 * Nothing in this bundle imports React, Vue, Solid, or a second copy of
 * Angular for the workers — those runtimes exist only inside their own
 * worker chunks.
 */
import '@angular/compiler';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { islandComponent } from '@atolljs/angular-island';
import { initDevtools } from '@atolljs/devtools';
import type { IslandHandle, IslandContractEventHandler, Mode } from '@atolljs/islands';

// Instrument before islands mount — the sink must exist when workers
// spawn for their events to forward. No-op unless the URL carries
// ?__atoll_devtools.
initDevtools({
  session: { name: 'islands-angular-host', framework: 'angular' },
  // Relative dashboard path — mounted hosts (the docs demo tree) ship
  // __atoll/ inside the app's own folder; absolute /__atoll/ would escape
  // a sub-path mount like consumer/<demo>/.
  overlay: { src: '__atoll/?mini=1' },
});
import counterContract from '../../mfe/contracts/counter.contract';
import notesContract from '../../mfe/contracts/notes.contract';
import tickerContract from '../../mfe/contracts/ticker.contract';
import dialContract from '../../mfe/contracts/dial.contract';
import checkoutContract from '../../mfe/contracts/checkout.contract';

const CounterIsland = islandComponent({ contract: counterContract, selector: 'counter-island' });
const NotesIsland = islandComponent({ contract: notesContract, selector: 'notes-island' });
const TickerIsland = islandComponent({ contract: tickerContract, selector: 'ticker-island' });
const DialIsland = islandComponent({ contract: dialContract, selector: 'dial-island' });
const CheckoutIsland = islandComponent({ contract: checkoutContract, selector: 'checkout-island' });

@Component({
  selector: 'atoll-shell',
  imports: [CounterIsland, NotesIsland, TickerIsland, DialIsland, CheckoutIsland],
  template: `
    <h1>Angular shell — five frameworks inside workers</h1>
    <p style="font: 12px monospace; color: #9aa4b2; margin-top: -8px">
      every island mounts through a framework-free <code>*.contract.ts</code> — [props] types off the
      contract schema, [onEvent] narrows to the declared vocabulary.
    </p>
    <div id="status-line">{{ status() }}</div>

    <section class="island">
      <div class="island-head"><span>counter — React worker</span><span class="badge">{{ pids()['counter'] ?? 'worker …' }}</span></div>
      <counter-island
        class="island-root"
        [mode]="mode"
        [props]="{ label: 'alpha' }"
        [onReady]="onReady('counter')"
        [onEvent]="onCounterEvent"
      />
      <pre class="island-code">{{ snippets.counter }}</pre>
    </section>

    <section class="island">
      <div class="island-head"><span>notes — Vue worker (createRenderer on the proxy DOM)</span><span class="badge">{{ pids()['notes'] ?? 'worker …' }}</span></div>
      <notes-island
        class="island-root"
        [mode]="mode"
        [props]="{ title: 'vue island' }"
        [onReady]="onReady('notes')"
        [onEvent]="onNotesEvent"
      />
      <pre class="island-code">{{ snippets.notes }}</pre>
    </section>

    <section class="island">
      <div class="island-head"><span>ticker — Solid worker (timer-driven emits)</span><span class="badge">{{ pids()['ticker'] ?? 'worker …' }}</span></div>
      <ticker-island
        class="island-root"
        [mode]="mode"
        [props]="{ label: 'pulse', intervalMs: 1000 }"
        [onReady]="onReady('ticker')"
        [onEvent]="onTickerEvent"
      />
      <pre class="island-code">{{ snippets.ticker }}</pre>
    </section>

    <section class="island">
      <div class="island-head"><span>dial — Svelte worker (mount() on the proxy DOM)</span><span class="badge">{{ pids()['dial'] ?? 'worker …' }}</span></div>
      <dial-island
        class="island-root"
        [mode]="mode"
        [props]="{ label: 'level', value: 40 }"
        [onReady]="onReady('dial')"
        [onEvent]="onDialEvent"
      />
      <pre class="island-code">{{ snippets.dial }}</pre>
    </section>

    <section class="island">
      <div class="island-head"><span>checkout — Angular worker (JIT + zoneless, signal inputs)</span><span class="badge">{{ pids()['checkout'] ?? 'worker …' }}</span></div>
      <checkout-island
        class="island-root"
        [mode]="mode"
        [props]="{ label: 'cart', total: 42 }"
        [onReady]="onReady('checkout')"
        [onEvent]="onCheckoutEvent"
      />
      <pre class="island-code">{{ snippets.checkout }}</pre>
    </section>
  `,
})
class ShellComponent {
  // No SharedArrayBuffer without COOP/COEP — the islands run in 50ms poll
  // mode where coi-sw.js can't isolate (first load, plain static hosts).
  readonly mode: Mode =
    typeof SharedArrayBuffer !== 'undefined' &&
    (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated)
      ? 'push'
      : 'poll';
  readonly status = signal('mounting islands…');
  readonly pids = signal<Record<string, string>>({});

  readonly onReady = (key: string) => (handle: IslandHandle): void => {
    this.pids.update((p) => ({ ...p, [key]: `worker ${handle.pid}` }));
  };

  /* Each handler is narrowed to its contract's event vocabulary — the
   * payload types come off the `z` schemas, not the worker components. */
  readonly onCounterEvent: IslandContractEventHandler<typeof counterContract> = (name, payload) => {
    if (name === 'incremented')
      this.status.set(`${payload.label} counter → ${payload.count} (React state stayed in the worker)`);
  };
  readonly onNotesEvent: IslandContractEventHandler<typeof notesContract> = (name, payload) => {
    if (name === 'noteAdded')
      this.status.set(`notes island emitted noteAdded → "${payload.text}" (${payload.total} total)`);
  };
  readonly onTickerEvent: IslandContractEventHandler<typeof tickerContract> = (name, payload) => {
    if (name === 'tick') this.status.set(`ticker island emitted tick → ${payload.count}`);
  };
  readonly onDialEvent: IslandContractEventHandler<typeof dialContract> = (name, payload) => {
    if (name === 'changed') this.status.set(`dial island emitted changed → ${payload.value}`);
  };
  readonly onCheckoutEvent: IslandContractEventHandler<typeof checkoutContract> = (name, payload) => {
    if (name === 'paid') this.status.set(`checkout island emitted paid → $${payload.total}`);
  };

  /** The call-site code rendered under each island — this file's own idiom. */
  readonly snippets = {
    counter: `const CounterIsland = islandComponent({
  contract: counterContract, selector: 'counter-island' })

<counter-island [props]="{ label: 'alpha' }" [onEvent]="onCounterEvent" />`,
    notes: `const NotesIsland = islandComponent({
  contract: notesContract, selector: 'notes-island' })

<notes-island [props]="{ title: 'vue island' }" [onEvent]="onNotesEvent" />`,
    ticker: `const TickerIsland = islandComponent({
  contract: tickerContract, selector: 'ticker-island' })

<ticker-island [props]="{ label: 'pulse', intervalMs: 1000 }" [onEvent]="onTickerEvent" />`,
    dial: `const DialIsland = islandComponent({
  contract: dialContract, selector: 'dial-island' })

<dial-island [props]="{ label: 'level', value: 40 }" [onEvent]="onDialEvent" />`,
    checkout: `const CheckoutIsland = islandComponent({
  contract: checkoutContract, selector: 'checkout-island' })

<checkout-island [props]="{ label: 'cart', total: 42 }" [onEvent]="onCheckoutEvent" />`,
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
