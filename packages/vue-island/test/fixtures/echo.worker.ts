/**
 * Minimal island worker entry for the `useIsland`/`<MeshIsland/>` tests —
 * one 1:1 realm worker serving a single imperative app: a div echoing
 * props.text, plus a 'ready' emit on every build so the shell can see the
 * island→shell event channel fire. The app def is `islandApp`-stamped so
 * the shell can also mount it by reference; a single-app worker resolves
 * its sole app regardless of the requested name.
 */
import {
  defineRealmWorker,
  emit,
  islandApp,
  type ProxyDocument,
} from '@jwhenry123/mesh-worker-dom/worker';

export const echoApp = islandApp('echo', {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    const el = doc.createElement('div');
    el.className = 'echo';
    el.textContent = String(props.text ?? 'echo');
    doc.body.append(el);
    // Runs inside the mount/updateProps realm scope — the emit op rides
    // back in the same op batch and lands on the island's onEvent.
    emit('ready', { text: el.textContent });
  },
});

export const echoWorker = defineRealmWorker(echoApp);
