/**
 * Perf-harness worker entry — a registry with two equivalent apps so the
 * same tree can be measured under both update semantics:
 *
 *   'tree'    — imperative proxy-DOM app: mount builds an N-row tree;
 *               updateProps is the coarse path (clear + rebuild).
 *   'rtree'   — React component rendering the same tree: updateProps diffs
 *               and only changed cells cross as ops.
 *   'rcounter'— one stateful button: a click dispatch → setState → commit.
 *
 * Rows carry an attr (dataset.index), a class, a text child, and a click
 * listener — the realistic mix of op types a sub-application produces.
 */
import { createElement, useState } from 'react';
import {
  defineIslandWorker,
  emit,
  islandApp,
  type ProxyDocument,
} from '@jwhenry123/mesh-worker-dom/worker';

const ROWS_DEFAULT = 200;

function buildTree(doc: ProxyDocument, rows: number, label: string): void {
  const root = doc.createElement('div');
  root.className = 'tree';
  for (let i = 0; i < rows; i++) {
    const row = doc.createElement('div');
    row.className = 'row';
    row.dataset.index = String(i);
    const cell = doc.createElement('span');
    cell.className = 'cell';
    cell.textContent = `${label} ${i}`;
    const bump = doc.createElement('button');
    bump.className = 'bump';
    bump.textContent = 'x';
    bump.addEventListener('click', () => {
      // dispatch → one utext op back.
      cell.textContent = `${label} ${i}!`;
      emit('bumped', { i });
    });
    row.append(cell, bump);
    root.append(row);
  }
  doc.body.append(root);
}

export const treeApp = islandApp('tree', {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    buildTree(doc, Number(props.rows ?? ROWS_DEFAULT), String(props.label ?? 'row'));
  },
});

function RTree(props: Record<string, unknown>) {
  const rows = Number(props.rows ?? ROWS_DEFAULT);
  const label = String(props.label ?? 'row');
  return createElement(
    'div',
    { className: 'tree' },
    Array.from({ length: rows }, (_, i) =>
      createElement(
        'div',
        { className: 'row', 'data-index': i, key: i },
        createElement('span', { className: 'cell' }, `${label} ${i}`),
        createElement('button', { className: 'bump' }, 'x'),
      ),
    ),
  );
}

function RCounter(props: Record<string, unknown>) {
  const [n, setN] = useState(0);
  return createElement(
    'button',
    { className: 'btn', onClick: () => setN((c) => c + 1) },
    `${String(props.label ?? 'count')}: ${n}`,
  );
}

/**
 * 'ticker' — commits outside any task: a setTimeout mutates the doc after
 * mount returns. The only way those ops reach the DOM is the doorbell (or
 * a manual flush) — the auto-subscribe test mounts it with no setMode call.
 */
export const tickerApp = islandApp('ticker', {
  imperative: (doc: ProxyDocument): void => {
    const first = doc.createElement('div');
    first.textContent = 'tick';
    doc.body.append(first);
    setTimeout(() => {
      const second = doc.createElement('div');
      second.className = 'tocked';
      second.textContent = 'tock';
      doc.body.append(second);
    }, 0);
  },
});

/**
 * 'tpl' — writes directly into `template.content` (which used to emit no
 * ops: the content view carried a phantom id), then clones the content into
 * the live tree the way Svelte/instantiation patterns do.
 */
export const templateApp = islandApp('tpl', {
  imperative: (doc: ProxyDocument): void => {
    const tpl = doc.createElement('template');
    doc.body.append(tpl);
    const inner = doc.createElement('span');
    inner.textContent = 'inside template';
    tpl.content!.appendChild(inner);
    const host = doc.createElement('div');
    host.className = 'instantiated';
    host.append(tpl.content!.cloneNode(true));
    doc.body.append(host);
  },
});

/**
 * 'cb' — calls a callbackProp-marshalled function from inside an event
 * handler (and once from a timer, exercising the out-of-task doorbell path).
 */
export const callbackApp = islandApp('cb', {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    const btn = doc.createElement('button');
    btn.className = 'call-me';
    btn.textContent = 'call';
    btn.addEventListener('click', () => {
      (props.onAction as ((v: string) => void) | undefined)?.('from worker');
      const nested = props.deep as { later?: (v: string) => void } | undefined;
      nested?.later?.('nested');
    });
    doc.body.append(btn);
  },
});

export const perfWorker = defineIslandWorker({
  apps: {
    tree: treeApp,
    rtree: RTree,
    rcounter: RCounter,
    ticker: tickerApp,
    tpl: templateApp,
    cb: callbackApp,
  },
});
