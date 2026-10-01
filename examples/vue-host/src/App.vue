<script setup lang="ts">
/**
 * Vue host — FIVE worker-rendered micro-frontends, five frameworks.
 *
 * The shell imports only CONTRACT modules (`../../mfe/contracts/*`):
 * `islandComponent(contract)` produces a facade whose attrs forward as the
 * island's props, `onEvent` narrows to the contract's event vocabulary, and
 * the contract's own `worker` field supplies the connection — no worker
 * plumbing at the call site.
 *
 * Nothing in this bundle imports React, Solid, Svelte, or Angular — those
 * runtimes exist only inside their own worker chunks.
 */
import { reactive } from 'vue';
import { islandComponent } from '@atolljs/vue-island';
import type { IslandHandle, Mode } from '@atolljs/islands';
import counterContract from '../../mfe/contracts/counter.contract';
import notesContract from '../../mfe/contracts/notes.contract';
import tickerContract from '../../mfe/contracts/ticker.contract';
import dialContract from '../../mfe/contracts/dial.contract';
import checkoutContract from '../../mfe/contracts/checkout.contract';

const CounterIsland = islandComponent(counterContract);   // React in the worker
const NotesIsland = islandComponent(notesContract);       // Vue
const TickerIsland = islandComponent(tickerContract);     // Solid
const DialIsland = islandComponent(dialContract);         // Svelte
const CheckoutIsland = islandComponent(checkoutContract); // Angular

// No SharedArrayBuffer without COOP/COEP — fall back to the 50ms poll
// transport so the demo still runs where coi-sw.js can't isolate (first
// load, non-Chromium, plain static hosts).
const mode: Mode =
  typeof SharedArrayBuffer !== 'undefined' &&
  (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated)
    ? 'push'
    : 'poll';

const state = reactive({
  status: 'mounting islands…',
  pids: {} as Record<string, string>,
});

const ready =
  (key: string) =>
  (handle: IslandHandle): void => {
    state.pids[key] = `worker ${handle.pid}`;
  };

// Facade opts — every attribute that isn't a shell key forwards as the
// island's props, so `label`/`total` here reach the worker app directly.
const counterOpts = {
  label: 'alpha',
  mode,
  onReady: ready('counter'),
  onEvent: (name: string, payload: unknown) => {
    const p = payload as { count: number; label: string };
    if (name === 'incremented')
      state.status = `${p.label} counter → ${p.count} (React state stayed in the worker)`;
  },
};
const notesOpts = {
  title: 'vue island',
  mode,
  onReady: ready('notes'),
  onEvent: (name: string, payload: unknown) => {
    const p = payload as { text: string; total: number };
    if (name === 'noteAdded')
      state.status = `notes island emitted noteAdded → "${p.text}" (${p.total} total)`;
  },
};
const tickerOpts = {
  label: 'pulse',
  intervalMs: 1000,
  mode,
  onReady: ready('ticker'),
  onEvent: (name: string, payload: unknown) => {
    const p = payload as { count: number };
    if (name === 'tick') state.status = `ticker island emitted tick → ${p.count}`;
  },
};
const dialOpts = {
  label: 'level',
  value: 40,
  mode,
  onReady: ready('dial'),
  onEvent: (name: string, payload: unknown) => {
    const p = payload as { value: number };
    if (name === 'changed') state.status = `dial island emitted changed → ${p.value}`;
  },
};
const checkoutOpts = {
  label: 'cart',
  total: 42,
  mode,
  onReady: ready('checkout'),
  onEvent: (name: string, payload: unknown) => {
    const p = payload as { total: number };
    if (name === 'paid') state.status = `checkout island emitted paid → $${p.total}`;
  },
};

/** The call-site code rendered under each island — this file's own idiom. */
const SNIPPETS = {
  counter: `const CounterIsland = islandComponent(counterContract)

<CounterIsland v-bind="{ label: 'alpha', onEvent }" />`,
  notes: `const NotesIsland = islandComponent(notesContract)

<NotesIsland v-bind="{ title: 'vue island', onEvent }" />`,
  ticker: `const TickerIsland = islandComponent(tickerContract)

<TickerIsland v-bind="{ label: 'pulse', intervalMs: 1000, onEvent }" />`,
  dial: `const DialIsland = islandComponent(dialContract)

<DialIsland v-bind="{ label: 'level', value: 40, onEvent }" />`,
  checkout: `const CheckoutIsland = islandComponent(checkoutContract)

<CheckoutIsland v-bind="{ label: 'cart', total: 42, onEvent }" />`,
};
</script>

<template>
  <h1>Vue shell — five frameworks inside workers</h1>
  <p style="font: 12px monospace; color: #9aa4b2; margin-top: -8px">
    every island mounts through a framework-free <code>*.contract.ts</code> — attrs forward as props,
    <code>onEvent</code> narrows to the declared vocabulary.
  </p>
  <div id="status-line">{{ state.status }}</div>

  <section class="island">
    <div class="island-head">
      <span>counter — React worker</span>
      <span class="badge">{{ state.pids.counter ?? 'worker …' }}</span>
    </div>
    <CounterIsland v-bind="counterOpts" class="island-root" />
    <pre class="island-code">{{ SNIPPETS.counter }}</pre>
  </section>

  <section class="island">
    <div class="island-head">
      <span>notes — Vue worker (createRenderer on the proxy DOM)</span>
      <span class="badge">{{ state.pids.notes ?? 'worker …' }}</span>
    </div>
    <NotesIsland v-bind="notesOpts" class="island-root" />
    <pre class="island-code">{{ SNIPPETS.notes }}</pre>
  </section>

  <section class="island">
    <div class="island-head">
      <span>ticker — Solid worker (timer-driven emits)</span>
      <span class="badge">{{ state.pids.ticker ?? 'worker …' }}</span>
    </div>
    <TickerIsland v-bind="tickerOpts" class="island-root" />
    <pre class="island-code">{{ SNIPPETS.ticker }}</pre>
  </section>

  <section class="island">
    <div class="island-head">
      <span>dial — Svelte worker (mount() on the proxy DOM)</span>
      <span class="badge">{{ state.pids.dial ?? 'worker …' }}</span>
    </div>
    <DialIsland v-bind="dialOpts" class="island-root" />
    <pre class="island-code">{{ SNIPPETS.dial }}</pre>
  </section>

  <section class="island">
    <div class="island-head">
      <span>checkout — Angular worker (JIT + zoneless, signal inputs)</span>
      <span class="badge">{{ state.pids.checkout ?? 'worker …' }}</span>
    </div>
    <CheckoutIsland v-bind="checkoutOpts" class="island-root" />
    <pre class="island-code">{{ SNIPPETS.checkout }}</pre>
  </section>
</template>
