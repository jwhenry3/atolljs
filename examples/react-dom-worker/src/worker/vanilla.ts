/**
 * The 'vanilla' island app — an imperative widget built ONLY on the proxy
 * DOM (src/worker/proxyDom.ts). There is no React anywhere in this realm:
 * no reconciler, no container, no JSX — this file doesn't even import
 * react. Every mutation in build() IS an op, queued straight onto the
 * realm's op stream; the worker's mount() just runs build() inside
 * runInRealm and drains the queue (see render.worker.ts).
 *
 * What it exercises:
 *   - nested createElement/createTextNode + appendChild
 *   - className, classList.add/toggle, setAttribute, dataset
 *   - style mutation via the style Proxy
 *   - addEventListener → listen ops → dispatched EventPayloads that mutate
 *     OTHER nodes (readout.textContent, sibling classLists — read+write on
 *     the shadow tree inside a realm task)
 *   - childNodes reads + removeChild to bound a scrolling log
 *   - getElementById / querySelectorAll on the local tree
 *   - emit() back to the shell, carrying event coordinates
 */
import { emit } from './hostConfig';
import type { ProxyDocument } from './proxyDom';
import type { EventPayload } from '../ops';

const SWATCHES = [
  { name: 'blue', color: '#2d6cdf' },
  { name: 'green', color: '#1f9d55' },
  { name: 'amber', color: '#b7791f' },
  { name: 'red', color: '#c53030' },
  { name: 'violet', color: '#805ad5' },
];

const MAX_LOG_LINES = 5;

export function buildVanilla(doc: ProxyDocument, props: Record<string, unknown>): void {
  const title =
    typeof props.title === 'string' ? props.title : 'vanilla island — proxy DOM only, no React';

  const section = doc.createElement('section');
  section.id = 'vanilla-root'; // id setter → attr op + the doc's id map
  section.className = 'vanilla-widget'; // → attr { name:'class' }

  const heading = doc.createElement('p');
  heading.classList.add('vanilla-heading');
  heading.appendChild(doc.createTextNode(title));
  section.appendChild(heading);

  const row = doc.createElement('div');
  row.className = 'vanilla-swatches';
  row.style.display = 'flex'; // style proxy → style ops, one per changed key
  row.style.gap = '8px';
  row.style.alignItems = 'center';

  const readout = doc.createElement('p');
  readout.className = 'vanilla-readout';
  readout.dataset.role = 'readout'; // dataset proxy → attr { name:'data-role' }
  readout.textContent = 'pick a swatch — the click round-trips into this worker';

  const log = doc.createElement('div');
  log.id = 'vanilla-log';
  log.className = 'vanilla-log';

  const appendLog = (msg: string): void => {
    const line = doc.createElement('div');
    line.className = 'vanilla-log-line';
    line.textContent = msg; // utext op + a phantom text child in the shadow tree
    log.appendChild(line);
    // Bound the log — shadow-tree reads (childNodes/firstChild) + remove ops.
    while (log.childNodes.length > MAX_LOG_LINES) {
      const first = log.firstChild;
      if (first === null) break;
      log.removeChild(first);
    }
  };

  for (const { name, color } of SWATCHES) {
    const swatch = doc.createElement('button');
    swatch.className = 'swatch';
    swatch.dataset.color = color;
    swatch.setAttribute('aria-label', `pick ${name}`);
    swatch.style.width = '28px';
    swatch.style.height = '28px';
    swatch.style.background = color;
    swatch.addEventListener('click', (e: EventPayload) => {
      // Dispatched back into the worker — inside runInRealm, so emit() routes
      // and every mutation below lands on this island's op queue.
      const picked = swatch.dataset.color ?? color;
      for (const sib of row.children) sib.classList.toggle('active', sib === swatch);
      readout.style.color = picked;
      readout.textContent = `picked ${picked} · click at (${e.clientX ?? '?'}, ${e.clientY ?? '?'})`;
      // Shadow-tree lookups work inside the realm too — same tree the ops built.
      const found = doc.getElementById('vanilla-log');
      appendLog(`clicked ${picked}${found === log ? ' · log found via getElementById' : ''}`);
      emit('colorPicked', { color: picked, x: e.clientX, y: e.clientY, targetId: e.targetId });
    });
    row.appendChild(swatch);
  }

  section.appendChild(row);
  section.appendChild(readout);
  section.appendChild(log);
  doc.body.appendChild(section); // → append { parent: 0 } — the island root

  // A seed line that proves local-tree reads ran worker-side at mount.
  appendLog(`${row.children.length} swatches · querySelectorAll('.swatch') → ${doc.querySelectorAll('.swatch').length}`);
}
