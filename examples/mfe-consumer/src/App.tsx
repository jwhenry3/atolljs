/**
 * Consumer shell — the other half of the MFE pair.
 *
 * Everything this file knows about the counter MFE arrives through the
 * package import: `@atolljs/mfe-counter` resolves (via the package's
 * `exports` map) to `../mfe-publish/src/mfe/counter.contract.ts`, a
 * framework-free contract. The shell imports NO worker source and bundles
 * NO worker framework — the contract's `worker` factory resolves the
 * producer's prebuilt `dist-mfe/counter.worker.js` package-relative, and
 * this app's bundler emits that file as an asset (or `VITE_MFE_ORIGIN`
 * repoints it at a remote origin — same contract, no rebuild of the
 * contract itself needed beyond env replacement).
 *
 * `islandComponent(contract)` produces a typed facade — `label?: string`
 * and `onEvent` narrowed to 'incremented' → { count, label } — straight off
 * the contract's `z` schemas.
 */
import { useState } from 'react';
import { islandComponent } from '@atolljs/react-island';
import type { Mode } from '@atolljs/islands';
import counterContract from '@atolljs/mfe-counter';

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
      <h1>mfe-consumer</h1>
      <p className="note">
        This shell's only MFE dependency is the contract module from{' '}
        <code>@atolljs/mfe-counter</code> (<code>file:../mfe-publish</code>).
        The worker below is the producer's prebuilt{' '}
        <code>dist-mfe/counter.worker.js</code> — resolved package-relative,
        emitted as an asset by this app's build. Set{' '}
        <code>VITE_MFE_ORIGIN=http://localhost:5186</code> to fetch it from
        the producer's <code>preview:mfe</code> server instead (the CDN
        shape).
      </p>
      <div className="island">
        <div className="island-head">
          <span>counter — imported contract, prebuilt worker asset</span>
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
