/**
 * Minimal island worker entry for the `[meshIsland]` / `<mesh-island>` tests
 * — one imperative realm app: a div echoing props.text plus a button that
 * emits over the island→shell channel. `defineRealmWorker` registers the
 * single `islandApp`-stamped def (1:1 topology — the shell's `app` input is
 * optional, though passing 'echo' documents the contract).
 */
import {
  defineRealmWorker,
  emit,
  islandApp,
  type ProxyDocument,
} from '@jwhenry123/mesh-worker-dom/worker';

export const echoApp = islandApp('echo', {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    const div = doc.createElement('div');
    div.className = 'echo';
    div.textContent = String(props.text ?? 'echo');
    const btn = doc.createElement('button');
    btn.className = 'ping';
    btn.textContent = 'ping';
    btn.addEventListener('click', () => emit('pinged', { n: 1 }));
    doc.body.append(div, btn);
    // Island → shell notification that the first render committed.
    emit('ready', { text: props.text ?? null });
  },
});

export const echoWorker = defineRealmWorker(echoApp);
