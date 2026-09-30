/**
 * Imperative-app fixture for the `use:island` gap tests:
 *
 *   'slotter' — emits a `data-atoll-slot` element so the action's `slots`
 *               option (via the slotProxy latest-map indirection) runs.
 *   'boomer'  — throws while building when props.boom is set: mount-time
 *               boom → the onError path; post-mount boom → updateProps
 *               rejection → report().
 */
import {
  definePolyWorker,
  islandApp,
  type ProxyDocument,
} from '@atolljs/islands/worker';

export const slotterApp = islandApp('slotter', {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    const anchor = doc.createElement('div');
    anchor.className = 'anchor';
    anchor.setAttribute('data-atoll-slot', 'plug');
    const p = doc.createElement('p');
    p.className = 'plug-label';
    p.textContent = String(props.text ?? 'slotter');
    doc.body.append(anchor, p);
  },
});

export const boomerApp = islandApp('boomer', {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    if (props.boom === true) throw new Error('boomer exploded');
    const p = doc.createElement('p');
    p.className = 'boomer-ok';
    p.textContent = String(props.text ?? 'stable');
    doc.body.append(p);
  },
});

export const domExtrasWorker = definePolyWorker({
  apps: { slotter: slotterApp, boomer: boomerApp },
});
