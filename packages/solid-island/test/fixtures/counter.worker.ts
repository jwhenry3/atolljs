/**
 * Island worker entry for the Solid-renderer suite — a 1:1 instance worker
 * serving one `solidIslandApp`-wrapped function component: a prop-driven
 * label, a button whose click bumps a `createSignal` (proving the
 * dispatch → handler → ops round trip) and `emit`s 'bumped' over the
 * island channel, plus a mount-time 'ready' emit. No JSX — the component
 * is authored with the package's `h()`/`insert()` primitives, exactly
 * what babel-preset-solid's universal output would emit calls into.
 */
import { createSignal } from 'solid-js';
import { defineMonoWorker, emit } from '@atolljs/islands/worker';
import { h, insert, solidIsland } from '../../src/worker';

function Counter(props: Record<string, unknown>): ReturnType<typeof h> {
  const [count, setCount] = createSignal(0);
  const label = h('span', { class: 'count' });
  // Tracked accessor — updates when EITHER the prop or the signal moves.
  insert(label, () => `${String(props.label)}: ${count()}`);
  // `onClick` in props — the compiled-JSX form: setProperty's `on*` case
  // routes it through addEventListener → a listen op → dispatch round trip.
  const bump = h(
    'button',
    {
      class: 'bump',
      onClick: () => {
        setCount((c) => c + 1);
        emit('bumped', { count: count() });
      },
    },
    'bump',
  );
  // The component body runs inside the mount task's instance scope, so this
  // emit rides back in the mount batch — the mount-time counterpart of
  // the imperative fixture's build()-time 'ready'.
  emit('ready', { label: props.label });
  return h('div', { class: 'counter' }, label, bump);
}

export const counterApp = solidIsland('counter', Counter);
export const counterWorker = defineMonoWorker(counterApp);
