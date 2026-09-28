/**
 * The demo app — it runs entirely inside the Web Worker.
 *
 * Everything here is ordinary React: hooks, memo, controlled inputs. The only
 * rule for worker-side components is no DOM access (no document/window/refs)
 * — the reconciler's host config translates the committed tree into ops.
 * Event handlers receive the plain { type, value, checked, key } payload the
 * main thread sends back, not a SyntheticEvent.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { EventPayload } from '../ops';

/**
 * Worker-side event handlers receive the plain wire payload — { type, value,
 * checked, key } — not a SyntheticEvent. `handler()` adapts them to the DOM
 * event prop types JSX expects; the cast is the whole story, nothing wraps
 * at runtime.
 */
const handler = <E,>(fn: (e: EventPayload) => void): ((e: E) => void) =>
  fn as unknown as (e: E) => void;

interface RowData {
  id: number;
  site: string;
  region: string;
  severity: number;
  incidents: number;
}

const ROW_COUNT = 2000;
const REGIONS = ['us-east', 'us-west', 'eu-central', 'ap-south', 'sa-east'];
const SEVERITIES = ['P1', 'P2', 'P3', 'P4'];

// Deterministic pseudo-data so every mount renders the same 2000 rows.
const DATA: RowData[] = Array.from({ length: ROW_COUNT }, (_, i) => ({
  id: i,
  site: `site-${(i * 7919) % 1409}`,
  region: REGIONS[i % REGIONS.length],
  severity: (i * 31) % 100,
  incidents: (i * 104729) % 977,
}));

const Row = memo(function Row({ row }: { row: RowData }) {
  return (
    <tr>
      <td>{row.id}</td>
      <td>{row.site}</td>
      <td>{row.region}</td>
      <td>
        <span
          style={{
            display: 'inline-block',
            padding: '1px 8px',
            borderRadius: '8px',
            fontSize: '12px',
            background: row.severity > 75 ? '#7d2b2b' : row.severity > 40 ? '#6f5a1e' : '#1f4d2e',
          }}
        >
          {SEVERITIES[row.severity % SEVERITIES.length]} · {row.severity}
        </span>
      </td>
      <td>{row.incidents}</td>
    </tr>
  );
});

/** A visibly non-trivial calculation — runs on the worker's thread, so the
 *  page (and its CSS spinner) never stutters while it crunches. */
function busyCompute(seed: number): number {
  let acc = seed;
  for (let i = 1; i < 4_000_000; i++) {
    acc += Math.sqrt((acc * 1664525 + i * 1013904223) % 2147483647);
  }
  return Math.round(acc) % 100_000;
}

export function App() {
  const [filter, setFilter] = useState('');
  const [desc, setDesc] = useState(false);
  const [count, setCount] = useState(0);
  const [computeSeed, setComputeSeed] = useState(1);
  const [effectRan, setEffectRan] = useState(false);

  // Proves the async path: the state update inside this effect is committed
  // after mount, so its ops arrive via the main thread's flush() polling.
  useEffect(() => {
    setEffectRan(true);
  }, []);

  const computeResult = useMemo(() => busyCompute(computeSeed), [computeSeed]);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const filtered = f === '' ? DATA : DATA.filter(
      (r) =>
        r.site.includes(f) ||
        r.region.includes(f) ||
        String(r.severity).startsWith(f) ||
        SEVERITIES[r.severity % SEVERITIES.length].toLowerCase() === f,
    );
    const sorted = [...filtered].sort((a, b) => (desc ? b.id - a.id : a.id - b.id));
    return sorted;
  }, [filter, desc]);

  // Event payloads are plain objects: { type, value, checked, key }.
  const onFilter = useCallback((e: EventPayload) => setFilter(e.value ?? ''), []);
  const bump = useCallback(() => setCount((c) => c + 1), []);
  const runCompute = useCallback(() => setComputeSeed((s) => s + 1), []);
  const toggleSort = useCallback(() => setDesc((d) => !d), []);

  return (
    <section>
      <h1>React is rendering in a Web Worker</h1>
      <p>
        The component tree below — hooks, memo, controlled inputs, a 2000-row
        list — is reconciled off the main thread. Only DOM mutation ops cross
        postMessage. <strong>{effectRan ? 'passive effects flushed ✓' : 'mounting…'}</strong>
      </p>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', margin: '16px 0' }}>
        <button onClick={handler(bump)}>count: {count}</button>
        <button onClick={handler(runCompute)}>compute (busy loop in worker)</button>
        <span>
          compute result: <code>{computeResult}</code>
        </span>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', margin: '16px 0' }}>
        <input
          type="text"
          placeholder="filter 2000 rows (site, region, severity)…"
          value={filter}
          onInput={handler(onFilter)}
          style={{ flex: 1 }}
        />
        <button onClick={handler(toggleSort)}>sort: {desc ? 'desc' : 'asc'}</button>
        <span>{rows.length} rows</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>site</th>
            <th>region</th>
            <th>severity</th>
            <th>incidents</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
