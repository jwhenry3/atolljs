/**
 * 'ticker' worker entry — the Solid micro-frontend, one app per worker.
 * A setInterval inside the component emits `tick` on its own schedule —
 * outside any task, so it re-enters the instance with runInInstance (the
 * instance is captured while the component runs inside mount's scope).
 */
import { createSignal, onCleanup } from 'solid-js';
import { defineSolidMonoWorker, emit, h, insert } from '@atolljs/solid-island/worker';
import { bumpOpsVersion, getActiveInstance, runInInstance } from '@atolljs/islands/worker';
import tickerContract from '../contracts/ticker.contract';

function Ticker(props: Record<string, unknown>): ReturnType<typeof h> {
  const [count, setCount] = createSignal(0);
  const label = h('span', { class: 'mfe-heading' });
  insert(label, () => `${props.label ?? 'solid mfe'}: ${count()}`);
  const interval = Number(props.intervalMs ?? 1000);
  // Mount's task scope is active NOW — capture the instance for the
  // interval callbacks, which fire outside any task.
  const scope = getActiveInstance();
  const timer = setInterval(() => {
    if (scope === undefined) return;
    runInInstance(scope, () => {
      const n = count() + 1;
      setCount(n);
      emit('tick', { count: n });
      // Outside a task the doorbell isn't rung implicitly — wake the driver.
      bumpOpsVersion();
    });
  }, interval);
  onCleanup(() => clearInterval(timer));
  return h('div', { class: 'mfe-card' }, label);
}

export const tickerWorker = defineSolidMonoWorker(Ticker, { contract: tickerContract });
