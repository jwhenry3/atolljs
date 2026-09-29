/**
 * Minimal island worker entry for the `createIsland`/`Island` tests — a
 * instance worker (1:1 topology) serving one `islandApp`-stamped imperative
 * app: a div echoing props.text, a button whose click dispatches back into
 * the instance and emits 'pinged', and a 'ready' emit on every build (mount
 * AND each imperative updateProps rebuild).
 */
import {
  defineMonoWorker,
  emit,
  islandApp,
  type ProxyDocument,
} from '@jwhenry123/mesh-islands/worker';

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
    // Instance-less op — routes by the instance mount holds active during build.
    emit('ready', { text: props.text ?? 'echo' });
  },
});

export const echoWorker = defineMonoWorker(echoApp);
