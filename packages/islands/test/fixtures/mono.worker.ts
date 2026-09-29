/**
 * MonoWorker fixture — one worker pinned to one stamped app. In-process it
 * joins the union registry under its 'mono' stamp; in a real bundle it would
 * be the sole entry.
 */
import {
  defineMonoWorker,
  islandApp,
  type ProxyDocument,
} from '@atolljs/islands/worker';

const monoApp = islandApp('mono', {
  imperative: (doc: ProxyDocument): void => {
    const el = doc.createElement('div');
    el.className = 'mono';
    el.textContent = 'mono island';
    doc.body.append(el);
  },
});

export const monoWorker = defineMonoWorker(monoApp);
