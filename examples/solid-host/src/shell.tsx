/** @jsxImportSource solid-js */
/**
 * Solid host — FIVE worker-rendered micro-frontends, five frameworks.
 *
 * The shell imports only CONTRACT modules (`../../mfe/contracts/*`):
 * `islandComponent(contract)` produces a component whose props are the
 * contract's prop type, `onEvent` narrows to the declared event vocabulary,
 * and the contract's `worker` field supplies the connection — call sites
 * wire nothing.
 *
 * Nothing in this bundle imports React, Vue, Svelte, or Angular — those
 * runtimes exist only inside their own worker chunks.
 */
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { islandComponent } from '@atolljs/solid-island';
import type { IslandHandle } from '@atolljs/islands';
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

// No SharedArrayBuffer without COOP/COEP — the doorbell option travels with
// the client (workerOptions.doorbell), and a doorbell-free client's 'push'
// mode falls back to 50ms polling automatically.
const isolated =
  typeof SharedArrayBuffer !== 'undefined' &&
  (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated);
const transport = { workerOptions: { doorbell: isolated } };

/** The call-site code rendered under each island — this file's own idiom. */
const SNIPPETS = {
  counter: `const CounterIsland = islandComponent(counterContract)

<CounterIsland label="alpha" onEvent={(name, p) => …} />`,
  notes: `const NotesIsland = islandComponent(notesContract)

<NotesIsland title="vue island" onEvent={(name, p) => …} />`,
  ticker: `const TickerIsland = islandComponent(tickerContract)

<TickerIsland label="pulse" intervalMs={1000} onEvent={…} />`,
  dial: `const DialIsland = islandComponent(dialContract)

<DialIsland label="level" value={40} onEvent={…} />`,
  checkout: `const CheckoutIsland = islandComponent(checkoutContract)

<CheckoutIsland label="cart" total={42} onEvent={…} />`,
};

function Shell() {
  const [status, setStatus] = createSignal('mounting islands…');
  const [pids, setPids] = createSignal<Record<string, string>>({});

  const ready =
    (key: string) =>
    (handle: IslandHandle): void => {
      setPids((p) => ({ ...p, [key]: `worker ${handle.pid}` }));
    };

  return (
    <>
      <h1>Solid shell — five frameworks inside workers</h1>
      <p style={{ font: '12px monospace', color: '#9aa4b2', 'margin-top': '-8px' }}>
        every island mounts through a framework-free <code>*.contract.ts</code> — props and{' '}
        <code>onEvent</code> payloads type off the contract's z schemas.
      </p>
      <div id="status-line">{status()}</div>

      <section class="island">
        <div class="island-head">
          <span>counter — React worker</span>
          <span class="badge">{pids().counter ?? 'worker …'}</span>
        </div>
        <CounterIsland
          label="alpha"
          {...transport}
          containerProps={{ class: 'island-root' }}
          onReady={ready('counter')}
          onEvent={(name, payload) => {
            if (name === 'incremented')
              setStatus(`${payload.label} counter → ${payload.count} (React state stayed in the worker)`);
          }}
        />
        <pre class="island-code">{SNIPPETS.counter}</pre>
      </section>

      <section class="island">
        <div class="island-head">
          <span>notes — Vue worker (createRenderer on the proxy DOM)</span>
          <span class="badge">{pids().notes ?? 'worker …'}</span>
        </div>
        <NotesIsland
          title="vue island"
          {...transport}
          containerProps={{ class: 'island-root' }}
          onReady={ready('notes')}
          onEvent={(name, payload) => {
            if (name === 'noteAdded')
              setStatus(`notes island emitted noteAdded → "${payload.text}" (${payload.total} total)`);
          }}
        />
        <pre class="island-code">{SNIPPETS.notes}</pre>
      </section>

      <section class="island">
        <div class="island-head">
          <span>ticker — Solid worker (timer-driven emits)</span>
          <span class="badge">{pids().ticker ?? 'worker …'}</span>
        </div>
        <TickerIsland
          label="pulse"
          intervalMs={1000}
          {...transport}
          containerProps={{ class: 'island-root' }}
          onReady={ready('ticker')}
          onEvent={(name, payload) => {
            if (name === 'tick') setStatus(`ticker island emitted tick → ${payload.count}`);
          }}
        />
        <pre class="island-code">{SNIPPETS.ticker}</pre>
      </section>

      <section class="island">
        <div class="island-head">
          <span>dial — Svelte worker (mount() on the proxy DOM)</span>
          <span class="badge">{pids().dial ?? 'worker …'}</span>
        </div>
        <DialIsland
          label="level"
          value={40}
          {...transport}
          containerProps={{ class: 'island-root' }}
          onReady={ready('dial')}
          onEvent={(name, payload) => {
            if (name === 'changed') setStatus(`dial island emitted changed → ${payload.value}`);
          }}
        />
        <pre class="island-code">{SNIPPETS.dial}</pre>
      </section>

      <section class="island">
        <div class="island-head">
          <span>checkout — Angular worker (JIT + zoneless, signal inputs)</span>
          <span class="badge">{pids().checkout ?? 'worker …'}</span>
        </div>
        <CheckoutIsland
          label="cart"
          total={42}
          {...transport}
          containerProps={{ class: 'island-root' }}
          onReady={ready('checkout')}
          onEvent={(name, payload) => {
            if (name === 'paid') setStatus(`checkout island emitted paid → $${payload.total}`);
          }}
        />
        <pre class="island-code">{SNIPPETS.checkout}</pre>
      </section>
    </>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) render(() => <Shell />, rootEl);
