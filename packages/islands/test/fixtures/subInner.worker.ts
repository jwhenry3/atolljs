/**
 * Inner-island fixture — the "sub-worker" a `mountSubIsland` call would
 * spawn inside the outer worker. In-process tests share the TaskRegistry,
 * so its apps are reachable from the sub-client's InProcessWorker too.
 */
import { definePolyWorker, emit, islandApp, type ProxyDocument } from '@atolljs/islands/worker';

export const innerApp = islandApp('inner', {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    const root = doc.createElement('div');
    root.className = 'inner';
    const label = doc.createElement('span');
    label.className = 'inner-label';
    label.textContent = `${String(props.label ?? 'inner')}:0`;
    const btn = doc.createElement('button');
    btn.className = 'inner-btn';
    btn.textContent = 'go';
    let n = 0;
    btn.addEventListener('click', () => {
      n++;
      label.textContent = `${String(props.label ?? 'inner')}:${n}`;
      emit('inner-tick', { n });
    });
    // Two slot anchors: a nested mount claims 'badge' through its own
    // `slots`; 'free' is unclaimed and bubbles to the outer island.
    const badge = doc.createElement('div');
    badge.setAttribute('data-atoll-slot', 'badge');
    const free = doc.createElement('div');
    free.setAttribute('data-atoll-slot', 'free');
    root.append(label, btn, badge, free);
    doc.body.append(root);
  },
});

export const subInnerWorker = definePolyWorker({
  apps: { inner: innerApp },
});
