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

export const perfWorker = defineIslandWorker({
  apps: { tree: treeApp, rtree: RTree, rcounter: RCounter },
});
