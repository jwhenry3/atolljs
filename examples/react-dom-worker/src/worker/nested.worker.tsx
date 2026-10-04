/**
 * Nested island worker — a THIRD tier in the worker topology. This entry is
 * spawned by a component INSIDE `react.worker.tsx` (itself a worker), not
 * by the main thread:
 *
 *   main thread shell ──▶ react.worker (island) ──▶ nested.worker (this)
 *
 * It's an ordinary `defineReactPolyWorker` registry — nested workers use
 * the exact same worker-side API as top-level island workers. `mountSubIsland`
 * (called by the parent's <SubIsland/> component) replays this worker's op
 * batches into the parent island's shadow tree, so its DOM lands inside the
 * outer island on the page.
 */
import { useState } from 'react';
import { defineReactPolyWorker, emit } from '@atolljs/react-island/worker';
import { islandApp, type EventPayload } from '@atolljs/islands/worker';

const handler = <E,>(fn: (e: EventPayload) => void): ((e: E) => void) =>
  fn as unknown as (e: E) => void;

/**
 * 'nested' — the deepest app in the demo: a counter with a `label` wire
 * prop and an 'incremented' emit. Two full hops away from the DOM: a click
 * on the real button dispatches main → react.worker → here; the re-render's
 * ops come back up through the parent's proxy DOM as part of its batch.
 */
const NestedCounterApp = islandApp('nested', function NestedCounterApp({
  label = 'nested',
}: {
  label?: string;
}) {
  const [count, setCount] = useState(0);
  return (
    <div className="react-counter" style={{ border: '1px dashed #6e7f94', padding: 8 }}>
      <span className="vanilla-heading">
        {label}: {count} <em style={{ color: '#6e7f94' }}>(two workers deep)</em>
      </span>
      <button
        className="mw-btn"
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
});

export const nestedWorker = defineReactPolyWorker({
  apps: { nested: NestedCounterApp },
});
