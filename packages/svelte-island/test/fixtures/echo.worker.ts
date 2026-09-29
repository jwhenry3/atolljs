/**
 * Minimal instance-worker fixture for the `use:island` action tests — ONE
 * imperative app stamped 'echo' via islandApp (a `defineMonoWorker`
 * resolves its single app regardless of the requested name, so the shell
 * can mount it namelessly or as 'echo'). The app echoes props.text into a
 * div, emits a 'ready' event on every (re)build, and a 'pinged' event on
 * button click — enough to prove mount, emit, updateProps, and dispatch.
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
    const text = String(props.text ?? 'echo');
    div.textContent = text;
    const btn = doc.createElement('button');
    btn.className = 'ping';
    btn.textContent = 'ping';
    btn.addEventListener('click', () => emit('pinged', { n: 1 }));
    doc.body.append(div, btn);
    // Island → shell channel: lands in the mount/update op batch the driver
    // routes to the island's onEvent callback.
    emit('ready', { text });
  },
});

export const echoWorker = defineMonoWorker(echoApp);
