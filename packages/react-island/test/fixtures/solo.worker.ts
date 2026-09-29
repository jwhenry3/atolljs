/**
 * A instance-worker fixture — `defineMonoWorker` registers ONE app (unstamped
 * → under 'main'), so shells mount it namelessly: `<Island worker/>`
 * and `islandComponent<P>()` both resolve 'main'. Distinct from the echo
 * fixture so a same-worker second island gets its own instance.
 */
import { defineMonoWorker, emit, type ProxyDocument } from '@atolljs/islands/worker';

export let disposed = false;

export const soloWorker = defineMonoWorker({
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    const p = doc.createElement('p');
    p.className = 'solo';
    p.textContent = String(props.label ?? 'solo instance');
    const btn = doc.createElement('button');
    btn.className = 'ping';
    btn.textContent = 'ping';
    btn.addEventListener('click', () => emit('pinged', { instance: 'solo' }));
    doc.body.append(p, btn);
  },
  dispose() {
    disposed = true;
  },
});
