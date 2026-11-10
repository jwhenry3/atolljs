/**
 * Federation host fixture — a dynamic-registry worker: one local app plus
 * three remote refs (importer form — the InProcessWorker shares the module
 * graph, so () => import() exercises the same loadApp seam a remote URL
 * would). `shared` publishes the 'greeting' dep into the realm's scope.
 */
import { defineFederationHost } from '@atolljs/federation/worker';
import type { ProxyDocument } from '@atolljs/islands/worker';

export const host = defineFederationHost({
  remotes: {
    fed: () => import('./remote-fed'),
    needy: () => import('./remote-needy'),
    badver: () => import('./remote-badver'),
  },
  apps: {
    local: {
      imperative: (doc: ProxyDocument): void => {
        const el = doc.createElement('div');
        el.className = 'local';
        el.textContent = 'local';
        doc.body.append(el);
      },
    },
  },
  shared: {
    greeting: { module: { text: 'hello' }, version: '1.2.0' },
  },
});
