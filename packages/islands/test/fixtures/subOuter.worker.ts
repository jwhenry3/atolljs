/**
 * Outer-island fixture — renders a `.sub-host` div the test hands to
 * nested `mountIsland`. `hostRef` stashes the ProxyElement (in-process tests
 * share module state, so the test file can pull it back out).
 */
import { definePolyWorker, islandApp, type ProxyDocument } from '@atolljs/islands/worker';
import type { ProxyElement } from '../../src/worker/dom/element';

export const hostRef: { el: ProxyElement | null } = { el: null };

export const outerApp = islandApp('subouter', {
  imperative: (doc: ProxyDocument): void => {
    const root = doc.createElement('div');
    root.className = 'outer';
    const host = doc.createElement('div');
    host.className = 'sub-host';
    root.append(host);
    doc.body.append(root);
    hostRef.el = host as unknown as ProxyElement;
  },
});

export const subOuterWorker = definePolyWorker({
  apps: { subouter: outerApp },
});
