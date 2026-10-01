/**
 * Dev harness — previews the package exactly the way a consumer sees it:
 * mounts the island through the contract, whose worker factory points at
 * the PREBUILT dist-mfe/counter.worker.js (run `npm run build:mfe` first —
 * `npm run build` does it for you).
 */
import { useState } from 'react';
import { islandComponent } from '@atolljs/react-island';
import type { Mode } from '@atolljs/islands';
import counterContract from './mfe/counter.contract';

const CounterIsland = islandComponent(counterContract);

const mode: Mode =
  typeof SharedArrayBuffer !== 'undefined' &&
  (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated)
    ? 'push'
    : 'poll';

export default function App() {
  const [events, setEvents] = useState<string[]>([]);
  return (
    <>
      <h1>@atolljs/mfe-counter</h1>
      <p className="note">
        This page mounts the island through{' '}
        <code>src/mfe/counter.contract.ts</code> — the package's only export.
        The worker running it is the prebuilt{' '}
        <code>dist-mfe/counter.worker.js</code> (self-contained; React lives
        inside it). Publish the package and a consumer gets the identical
        setup for free.
      </p>
      <div className="island">
        <div className="island-head">
          <span>counter — react worker, prebuilt bundle</span>
          <span className="badge">{mode}</span>
        </div>
        <CounterIsland
          label="alpha"
          containerProps={{ className: 'island-root' }}
          mode={mode}
          onEvent={(name, payload) =>
            setEvents((es) =>
              [`${name}: ${JSON.stringify(payload)}`, ...es].slice(0, 5),
            )
          }
        />
        <pre className="island-code">{`import { islandComponent } from '@atolljs/react-island';
import counterContract from '@atolljs/mfe-counter';

const CounterIsland = islandComponent(counterContract);

<CounterIsland label="alpha" onEvent={handler} />`}</pre>
        <ul className="mfe-list">
          {events.map((e, i) => (
            <li className="mfe-list-line" key={i}>
              {e}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
