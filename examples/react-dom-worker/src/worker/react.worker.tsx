/**
 * React island worker — a registry worker serving React apps through
 * `reactIslandApp` (react-reconciler bound to the instance's op stream).
 * Its bundle carries React but no Vue/Solid/Svelte/Angular — the point of
 * the demo: islands are framework-agnostic over one op protocol, and this
 * worker's apps are the same counter/notes/incidents set the other
 * framework shells mount.
 *
 * Unlike the other frameworks' async schedulers, React's commit runs inside
 * the dispatch's sync lane — `useLayoutEffect` fires while the task still
 * holds the instance, so `emit` from a commit-phase effect needs no
 * `runInInstance` re-entry (see TableApp's `rowsChanged` in apps.tsx).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { defineReactPolyWorker, emit } from '@atolljs/react-island/worker';
import { islandApp, type EventPayload } from '@atolljs/islands/worker';

/**
 * Worker-side event handlers receive the plain wire payload — { type, value,
 * checked, key, scrollTop } — not a SyntheticEvent. `handler()` adapts them
 * to the DOM event prop types JSX expects; the cast is the whole story.
 */
const handler = <E,>(fn: (e: EventPayload) => void): ((e: E) => void) =>
  fn as unknown as (e: E) => void;

/**
 * 'counter' — the canonical framework island: a `label` wire prop, a
 * `useState` count, and an 'incremented' emit for the shell's status line.
 */
const CounterApp = islandApp('counter', function CounterApp({
  label = 'count',
}: {
  label?: string;
}) {
  const [count, setCount] = useState(0);
  return (
    <div className="react-counter">
      <span className="vanilla-heading">
        {label}: {count}
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

/**
 * 'notes' — the notes composer: a controlled input, a `useState` list, and
 * a 'noteAdded' emit per add. `value` is a wire prop — the driver writes it
 * back onto the real input, so clearing the draft clears the field.
 */
const NotesApp = islandApp('notes', function NotesApp({
  title = 'react island',
}: {
  title?: string;
}) {
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const add = (): void => {
    const text = draft.trim();
    if (text === '') return;
    setNotes([...notes, text]);
    setDraft('');
    emit('noteAdded', { text, total: notes.length + 1 });
  };
  return (
    <div className="react-notes">
      <h3 className="vanilla-heading">{title}</h3>
      <div className="atoll-map-places">
        <input
          placeholder="write a note…"
          value={draft}
          // _enrichEvent stamps the wire payload's `value` onto the target.
          onInput={handler((e) => setDraft(e.value ?? ''))}
          onKeyDown={handler((e) => {
            if (e.key === 'Enter') add();
          })}
        />
        <button className="atoll-map-place-btn" onClick={handler(add)}>
          add
        </button>
      </div>
      <ul className="vanilla-log">
        {notes.map((n, i) => (
          <li key={i} className="vanilla-log-line">
            {n}
          </li>
        ))}
      </ul>
      <div className="vanilla-readout">{notes.length} note(s) — state lives in the worker</div>
    </div>
  );
});

/**
 * 'incidents' — the heavy-component benchmark: 1,000,000 incident records
 * in the worker, rendered through a virtualized scroller. The main thread
 * only ever sees ~22 rows of ops no matter how deep the user scrolls.
 *
 * Rows are lazily generated (deterministic pseudo-data — nothing is
 * materialized until it's visible). Each scroll event is a dispatch
 * round-trip — the driver stamps `scrollTop` onto the payload — the worker
 * re-renders the window and reports the re-render time back via 'rendered'.
 */
const REGIONS = ['us-east', 'us-west', 'eu-central', 'ap-south', 'sa-east'];
const SEVS = ['P1', 'P2', 'P3', 'P4'];
const ROW_H = 24;
const OV = 4;
const VISIBLE = Math.ceil(320 / ROW_H) + OV * 2;
const incident = (i: number) => ({
  id: i,
  site: `site-${(i * 7919) % 1409}`,
  region: REGIONS[i % REGIONS.length],
  sev: (i * 31) % 100,
  dur: `${((i * 104729) % 977) % 60}m`,
});
const sevClass = (s: number): string =>
  `inc-sev sev-p${s > 75 ? 1 : s > 40 ? 2 : s > 15 ? 3 : 4}`;
const sevLabel = (s: number): string => SEVS[s > 75 ? 0 : s > 40 ? 1 : s > 15 ? 2 : 3];

const IncidentsApp = islandApp('incidents', function IncidentsApp({
  count = 1_000_000,
}: {
  count?: number;
}) {
  const [start, setStart] = useState(0);
  const [lastMs, setLastMs] = useState(0);
  const t0 = useRef(performance.now());
  const prevKey = useRef('');

  const first = Math.min(start, Math.max(0, count - VISIBLE));
  const rows = Array.from({ length: Math.min(VISIBLE, count - first) }, (_, k) =>
    incident(first + k),
  );
  const end = first + rows.length - 1;

  // Commit-phase report: the delta from the scroll handler is the whole
  // worker-side re-render cost. React commits inside the dispatch's sync
  // lane, so emit here is still in instance scope — no runInInstance
  // re-entry needed. The window-key guard stops lastMs's own write from
  // looping back into another report.
  useLayoutEffect(() => {
    const key = `${first}:${end}`;
    if (key === prevKey.current) return;
    prevKey.current = key;
    const ms = performance.now() - t0.current;
    setLastMs(ms);
    emit('rendered', { start: first, end, ms });
  });

  return (
    <div className="incidents">
      <div className="inc-stats">
        {count.toLocaleString()} incidents · rows {first.toLocaleString()}–
        {end.toLocaleString()} · worker re-render {lastMs.toFixed(1)}ms
      </div>
      <div
        className="inc-viewport"
        onScroll={handler((e) => {
          t0.current = performance.now();
          // The driver stamps the scroller's scrollTop onto the wire
          // payload — the proxy element's geometry getters are stubs.
          setStart(Math.max(0, Math.floor((e.scrollTop ?? 0) / ROW_H) - OV));
        })}
      >
        <div className="inc-spacer" style={{ height: count * ROW_H }}>
          {rows.map((r) => (
            <div key={r.id} className="inc-row" style={{ top: r.id * ROW_H }}>
              <span className="inc-id">#{r.id}</span>
              <span className="inc-site">{r.site}</span>
              <span className="inc-region">{r.region}</span>
              <span className={sevClass(r.sev)}>
                {sevLabel(r.sev)} · {r.sev}
              </span>
              <span className="inc-dur">{r.dur}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export const reactWorker = defineReactPolyWorker({
  apps: { counter: CounterApp, notes: NotesApp, incidents: IncidentsApp },
});
