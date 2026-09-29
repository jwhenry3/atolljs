/**
 * Island worker entry for the renderer-surface suite — a REGISTRY worker
 * (defineSolidIslandWorker) serving three plain-function Solid components
 * that exercise the universal renderer's insertion paths through the real
 * op protocol:
 * - `conditional`: a tracked accessor swapping element branches on a signal
 *   (what <Show>/<Switch> compile to under generate:'universal').
 * - `reorder`: `mapArray` children from a signal array — the per-item node
 *   cache makes a reorder reach `reconcileArrays` as MOVES, not a rebuild.
 * - `proppatch`: two wire-props read by separate bindings that emit on every
 *   evaluation — proving updateProps re-runs only the changed key's readers.
 */
import { createSignal, mapArray } from 'solid-js';
import { emit } from '@jwhenry123/mesh-worker-dom/worker';
import {
  defineSolidIslandWorker,
  h,
  insert,
} from '../../src/worker';

function Conditional(props: Record<string, unknown>): ReturnType<typeof h> {
  const [on, setOn] = createSignal(props.on !== false);
  const branch = h('div', { class: 'branch' });
  // Show-style: the accessor returns a NEW node per branch — the universal
  // inserter's non-array path replaces it in place.
  insert(branch, () =>
    on() ? h('b', { class: 'yes' }, 'YES') : h('i', { class: 'no' }, 'NO'),
  );
  const toggle = h(
    'button',
    { class: 'toggle', onClick: () => setOn((v) => !v) },
    'toggle',
  );
  return h('div', { class: 'conditional' }, branch, toggle);
}

function Reorder(): ReturnType<typeof h> {
  const [items, setItems] = createSignal(['a', 'b', 'c']);
  const list = h('ul', { class: 'list' });
  // mapArray caches one node per unique item — a reorder hands
  // reconcileArrays a permutation of the same node identities.
  insert(
    list,
    mapArray(items, (item) => h('li', { class: `li-${item}` }, item)),
  );
  const rev = h(
    'button',
    { class: 'rev', onClick: () => setItems((xs) => [...xs].reverse()) },
    'reverse',
  );
  return h('div', { class: 'reorder' }, list, rev);
}

function PropPatch(props: Record<string, unknown>): ReturnType<typeof h> {
  const aEl = h('span', { class: 'pa' });
  const bEl = h('span', { class: 'pb' });
  // One emit per accessor evaluation — the shell counts 'eval-a'/'eval-b'
  // arrivals to see exactly which wire-prop keys re-ran their dependents.
  insert(aEl, () => {
    emit('eval-a', props.a);
    return String(props.a);
  });
  insert(bEl, () => {
    emit('eval-b', props.b);
    return String(props.b);
  });
  return h('div', { class: 'proppatch' }, aEl, bEl);
}

export const surfaceWorker = defineSolidIslandWorker({
  conditional: Conditional,
  reorder: Reorder,
  proppatch: PropPatch,
});
