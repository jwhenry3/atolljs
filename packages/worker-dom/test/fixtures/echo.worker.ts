/**
 * Minimal island worker entry for the `<Island/>` component tests — one
 * imperative app: a paragraph echoing props.text and a button that emits.
 */
import { defineIslandWorker, emit, type ProxyDocument } from '../../src/worker/index';

const echo = (doc: ProxyDocument, props: Record<string, unknown>): void => {
  const p = doc.createElement('p');
  p.className = 'echo';
  p.textContent = String(props.text ?? 'echo');
  const btn = doc.createElement('button');
  btn.className = 'ping';
  btn.textContent = 'ping';
  btn.addEventListener('click', () => emit('pinged', { n: 1 }));
  doc.body.append(p, btn);
};

export const echoWorker = defineIslandWorker({
  apps: { echo: { imperative: echo } },
});
