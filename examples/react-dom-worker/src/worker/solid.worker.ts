/**
 * Solid island worker — a registry worker serving hand-authored Solid
 * components through `solidIslandApp` (Solid's universal renderer bound to
 * the instance's proxy DOM). Its bundle carries Solid but no React — the
 * point of the demo: islands are framework-agnostic over one op protocol.
 *
 * Components are plain functions built on `h()`/`insert` (generate:
 * 'universal'); `solid-js` is aliased to its client build at bundle time —
 * `mount` would pull SSR entry points.
 */
import { createSignal, mapArray } from 'solid-js';
import {
  defineSolidPolyWorker,
  emit,
  h,
  insert,
} from '@atolljs/solid-island/worker';

/**
 * 'counter' — the docs' canonical Solid island: a `label` wire prop, a
 * `createSignal` count, a tracked `insert` that re-evaluates on click, and
 * an 'incremented' emit for the shell's status line.
 */
function Counter(props: Record<string, unknown>): ReturnType<typeof h> {
  const [count, setCount] = createSignal(0);
  const label = h('span', { class: 'vanilla-heading' });
  insert(label, () => `${props.label ?? 'count'}: ${count()}`);
  const bump = h(
    'button',
    {
      class: 'mw-btn',
      onClick: () => {
        const n = count() + 1;
        setCount(n);
        emit('incremented', { count: n, label: props.label });
      },
    },
    'increment',
  );
  return h('div', { class: 'solid-counter' }, label, bump);
}

/**
 * 'notes' — the notes composer from the Vue demo, re-done with mapArray:
 * `insert(list, mapArray(notes, ...))` renders the signal array into real
 * nodes whose identity survives appends.
 */
function Notes(props: Record<string, unknown>): ReturnType<typeof h> {
  let draft = '';
  const [notes, setNotes] = createSignal<string[]>([]);
  const input = h('input', {
    placeholder: 'write a note…',
    // _enrichEvent stamps the wire payload's `value` onto the target.
    onInput: (e: Event) => {
      draft = (e.target as HTMLInputElement).value;
    },
  });
  const add = (): void => {
    const text = draft.trim();
    if (text === '') return;
    setNotes([...notes(), text]);
    (input as unknown as HTMLInputElement).value = '';
    draft = '';
    emit('noteAdded', { text, total: notes().length });
  };
  input.addEventListener('keydown', (e) => {
    if ((e as { key?: string }).key === 'Enter') add();
  });
  const list = h('ul', { class: 'vanilla-log' });
  insert(list, mapArray(notes, (n) => h('li', { class: 'vanilla-log-line' }, n)));
  const readout = h('div', { class: 'vanilla-readout' });
  insert(
    readout,
    () => `${notes().length} note(s) — state lives in the worker`,
  );
  return h(
    'div',
    { class: 'solid-notes' },
    h('h3', { class: 'vanilla-heading' }, String(props.title ?? 'solid island')),
    h('div', { class: 'atoll-map-places' }, input, h('button', { class: 'atoll-map-place-btn', onClick: add }, 'add')),
    list,
    readout,
  );
}

/**
 * 'incidents' — the heavy-component benchmark: 1,000,000 incident records
 * in the worker, rendered through a virtualized scroller. The main thread
 * only ever sees ~20 rows of ops no matter how deep the user scrolls.
 * Rows are lazily generated — nothing is materialized until it's visible;
 * each scroll event re-evaluates the window and a 'rendered' emit reports
 * the re-render time back to the shell.
 */
const REGIONS = ['us-east', 'us-west', 'eu-central', 'ap-south', 'sa-east'];
const SEVS = ['P1', 'P2', 'P3', 'P4'];
const ROW_H = 24;
const VIEW = 320;
const OV = 4;
const VISIBLE = Math.ceil(VIEW / ROW_H) + OV * 2;
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

function Incidents(props: Record<string, unknown>): ReturnType<typeof h> {
  const total = (): number => Number(props.count ?? 1_000_000);
  const [start, setStart] = createSignal(0);
  const [lastMs, setLastMs] = createSignal(0);
  let t0 = performance.now();

  const spacer = h('div', {
    class: 'inc-spacer',
    style: `height:${total() * ROW_H}px`,
  });
  insert(spacer, () => {
    const s = Math.min(start(), Math.max(0, total() - VISIBLE));
    const n = Math.min(VISIBLE, total() - s);
    const rows = Array.from({ length: n }, (_, k) => {
      const r = incident(s + k);
      return h(
        'div',
        { class: 'inc-row', style: `top:${r.id * ROW_H}px` },
        h('span', { class: 'inc-id' }, `#${r.id}`),
        h('span', { class: 'inc-site' }, r.site),
        h('span', { class: 'inc-region' }, r.region),
        h('span', { class: sevClass(r.sev) }, `${sevLabel(r.sev)} · ${r.sev}`),
        h('span', { class: 'inc-dur' }, r.dur),
      );
    });
    const ms = performance.now() - t0;
    setLastMs(ms);
    emit('rendered', { start: s, end: s + n - 1, ms });
    return rows;
  });

  const stats = h('div', { class: 'inc-stats' });
  insert(
    stats,
    () =>
      `${total().toLocaleString()} incidents · rows ${Math.min(
        start(),
        Math.max(0, total() - VISIBLE),
      ).toLocaleString()}–${Math.min(
        start() + VISIBLE - 1,
        total() - 1,
      ).toLocaleString()} · worker re-render ${lastMs().toFixed(1)}ms`,
  );

  return h(
    'div',
    { class: 'incidents' },
    stats,
    h(
      'div',
      {
        class: 'inc-viewport',
        onScroll: (e: { scrollTop?: number }) => {
          t0 = performance.now();
          // The driver stamps the scroller's scrollTop onto the wire
          // payload — the proxy element's geometry getters are stubs.
          setStart(Math.max(0, Math.floor((e.scrollTop ?? 0) / ROW_H) - OV));
        },
      },
      spacer,
    ),
  );
}

export const solidWorker = defineSolidPolyWorker({
  apps: { counter: Counter, notes: Notes, incidents: Incidents },
});
