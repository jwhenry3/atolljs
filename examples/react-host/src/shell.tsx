/**
 * React host — FIVE worker-rendered micro-frontends, five frameworks.
 *
 * The shell imports only CONTRACT modules (`../../mfe/contracts/*`): each is
 * a framework-free `{ app, props schema, events schemas, worker factory }`
 * object. `islandComponent(contract)` produces a typed facade — props and
 * `onEvent` payloads come straight from the contract's `z` schemas — and
 * the contract's `worker` field supplies the connection, so the call sites
 * need no worker wiring at all.
 *
 * Nothing in this bundle imports Vue, Solid, Svelte, or Angular — those
 * runtimes exist only inside their own worker chunks.
 */
import { Suspense, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { islandComponent } from '@atolljs/react-island';
import { initDevtools } from '@atolljs/devtools';
import type { IslandHandle, Mode } from '@atolljs/islands';

// Instrument before islands mount — the sink must exist when workers
// spawn for their events to forward. No-op unless the URL carries
// ?__atoll_devtools.
initDevtools({ session: { name: 'islands-react-host' } });
import counterContract from '../../mfe/contracts/counter.contract';
import notesContract from '../../mfe/contracts/notes.contract';
import tickerContract from '../../mfe/contracts/ticker.contract';
import dialContract from '../../mfe/contracts/dial.contract';
import checkoutContract from '../../mfe/contracts/checkout.contract';

/* Each facade is typed end-to-end off its contract: `CounterIsland` takes
 * `{ label?: string }` props and an `onEvent` narrowed to
 * 'incremented' → { count, label }. */
const CounterIsland = islandComponent(counterContract);   // React in the worker
const NotesIsland = islandComponent(notesContract);       // Vue
const TickerIsland = islandComponent(tickerContract);     // Solid
const DialIsland = islandComponent(dialContract);         // Svelte
const CheckoutIsland = islandComponent(checkoutContract); // Angular

// SharedArrayBuffer only exists in cross-origin-isolated contexts — without
// COOP/COEP (and when coi-sw.js can't take, e.g. first visit) the doorbell
// can't bind, so islands run their 50ms poll transport instead of push.
const mode: Mode =
  typeof SharedArrayBuffer !== 'undefined' &&
  (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated)
    ? 'push'
    : 'poll';

/** The call-site code rendered under each island — the shell code itself. */
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

function Shell(): ReactElement {
  const [status, setStatus] = useState('mounting islands…');
  const [pids, setPids] = useState<Record<string, string>>({});
  const ready =
    (key: string) =>
    (handle: IslandHandle): void =>
      setPids((p) => ({ ...p, [key]: `worker ${handle.pid}` }));

  return (
    <>
      <h1>React shell — five frameworks inside workers</h1>
      <p style={{ font: '12px monospace', color: '#9aa4b2', marginTop: -8 }}>
        every island mounts through a framework-free <code>*.contract.ts</code> — props and events
        type-check at compile time AND validate at the worker boundary.
      </p>
      <div id="status-line">{status}</div>

      <section className="island">
        <div className="island-head">
          <span>counter — React worker</span>
          <span className="badge">{pids.counter ?? 'worker …'}</span>
        </div>
        <Suspense fallback={null}>
          <CounterIsland
            label="alpha"
            mode={mode}
            containerProps={{ className: 'island-root' }}
            onReady={ready('counter')}
            onEvent={(name, payload) => {
              if (name === 'incremented')
                setStatus(`${payload.label} counter → ${payload.count} (React state stayed in the worker)`);
            }}
          />
        </Suspense>
        <pre className="island-code"><code>{SNIPPETS.counter}</code></pre>
      </section>

      <section className="island">
        <div className="island-head">
          <span>notes — Vue worker (createRenderer on the proxy DOM)</span>
          <span className="badge">{pids.notes ?? 'worker …'}</span>
        </div>
        <Suspense fallback={null}>
          <NotesIsland
            title="vue island"
            mode={mode}
            containerProps={{ className: 'island-root' }}
            onReady={ready('notes')}
            onEvent={(name, payload) => {
              if (name === 'noteAdded')
                setStatus(`notes island emitted noteAdded → "${payload.text}" (${payload.total} total)`);
            }}
          />
        </Suspense>
        <pre className="island-code"><code>{SNIPPETS.notes}</code></pre>
      </section>

      <section className="island">
        <div className="island-head">
          <span>ticker — Solid worker (timer-driven emits)</span>
          <span className="badge">{pids.ticker ?? 'worker …'}</span>
        </div>
        <Suspense fallback={null}>
          <TickerIsland
            label="pulse"
            intervalMs={1000}
            mode={mode}
            containerProps={{ className: 'island-root' }}
            onReady={ready('ticker')}
            onEvent={(name, payload) => {
              if (name === 'tick') setStatus(`ticker island emitted tick → ${payload.count}`);
            }}
          />
        </Suspense>
        <pre className="island-code"><code>{SNIPPETS.ticker}</code></pre>
      </section>

      <section className="island">
        <div className="island-head">
          <span>dial — Svelte worker (mount() on the proxy DOM)</span>
          <span className="badge">{pids.dial ?? 'worker …'}</span>
        </div>
        <Suspense fallback={null}>
          <DialIsland
            label="level"
            value={40}
            mode={mode}
            containerProps={{ className: 'island-root' }}
            onReady={ready('dial')}
            onEvent={(name, payload) => {
              if (name === 'changed') setStatus(`dial island emitted changed → ${payload.value}`);
            }}
          />
        </Suspense>
        <pre className="island-code"><code>{SNIPPETS.dial}</code></pre>
      </section>

      <section className="island">
        <div className="island-head">
          <span>checkout — Angular worker (JIT + zoneless, signal inputs)</span>
          <span className="badge">{pids.checkout ?? 'worker …'}</span>
        </div>
        <Suspense fallback={null}>
          <CheckoutIsland
            label="cart"
            total={42}
            mode={mode}
            containerProps={{ className: 'island-root' }}
            onReady={ready('checkout')}
            onEvent={(name, payload) => {
              if (name === 'paid') setStatus(`checkout island emitted paid → $${payload.total}`);
            }}
          />
        </Suspense>
        <pre className="island-code"><code>{SNIPPETS.checkout}</code></pre>
      </section>
    </>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<Shell />);
