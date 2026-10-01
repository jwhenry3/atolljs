/**
 * 'counter' worker entry — the React micro-frontend, one app per worker
 * (defineReactMonoWorker). This file is the `vite.mfe.config.ts` lib entry:
 * it imports the contract for the wire schemas + app stamp, carries the
 * whole React runtime into the bundle, and is the artifact consumers
 * actually fetch (dist-mfe/counter.worker.js).
 *
 * Consumers never import this module — shells only import the contract.
 */
import { useState } from 'react';
import { defineReactMonoWorker, emit } from '@atolljs/react-island/worker';
import type { EventPayload } from '@atolljs/islands/worker';
import counterContract from './counter.contract';

// Worker-side handlers receive the plain wire payload, not a SyntheticEvent.
const handler = <E,>(fn: (e: EventPayload) => void): ((e: E) => void) =>
  fn as unknown as (e: E) => void;

function CounterApp({ label = 'react mfe' }: { label?: string }) {
  const [count, setCount] = useState(0);
  return (
    <div className="mfe-card">
      <span className="mfe-heading">
        {label}: {count}
      </span>
      <button
        className="mfe-btn"
        onClick={handler(() => {
          const n = count + 1;
          setCount(n);
          emit('incremented', { count: n, label });
        })}
      >
        increment
      </button>
    </div>
  );
}

export const counterWorker = defineReactMonoWorker(CounterApp, {
  contract: counterContract,
});
