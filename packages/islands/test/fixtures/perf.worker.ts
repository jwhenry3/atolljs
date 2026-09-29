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
import { createElement, useState, Suspense, use } from 'react';
import { createPortal } from 'react-dom';
import {
  definePolyWorker,
  emit,
  islandApp,
  type ProxyDocument,
  type RenderContext,
} from '@atolljs/islands/worker';
import { reactIslandApp } from '@atolljs/react-island/worker';
import { pushOp } from '../../src/worker/instance';
import type { InternalDocument } from '../../src/worker/dom/document';

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

/**
 * 'drive' — exercises the main-thread driver's op surface: attr ops (set,
 * removal incl. the slot/className/style/boolean branches), style ops
 * (custom props, !important, clears), remove ops on a subtree holding a
 * slot, listen/unlisten ops, and deliberately malformed ops that must hit
 * the driver's per-op "missing node" guards instead of throwing.
 */
export const driverApp = islandApp('drive', {
  imperative: (doc: ProxyDocument): void => {
    const instance = (doc as InternalDocument).instance;
    const input = doc.createElement('input');
    input.setAttribute('data-atoll-slot', 'plug');
    // Re-slotting the same element detaches the previous slot name.
    input.setAttribute('data-atoll-slot', 'plug2');
    input.setAttribute('style', 'color: red');
    input.setAttribute('id', 'i1');
    input.setAttribute('data-x', '1');
    input.setAttribute('checked', '');
    doc.body.append(input);
    input.removeAttribute('data-atoll-slot');
    input.removeAttribute('className');
    input.removeAttribute('style');
    input.removeAttribute('checked');
    input.removeAttribute('missing');

    const styled = doc.createElement('div');
    styled.className = 'styled';
    styled.style.setProperty('--brand', '#fff');
    styled.style.setProperty('color', 'red', 'important');
    styled.style.backgroundColor = 'blue';
    doc.body.append(styled);
    styled.style.removeProperty('color');

    // A slot nested in a removed subtree: the single `remove` op must
    // unmount it via the driver's subtree scan.
    const wrap = doc.createElement('div');
    const inner = doc.createElement('span');
    inner.setAttribute('data-atoll-slot', 'inner');
    wrap.appendChild(inner);
    doc.body.append(wrap);
    doc.body.removeChild(wrap);

    const boom = doc.createElement('button');
    boom.className = 'boom';
    const onBoom = () => {
      throw new Error('kaboom');
    };
    boom.addEventListener('click', onBoom);
    doc.body.append(boom);
    const gone = doc.createElement('i');
    const onGone = () => {};
    gone.addEventListener('click', onGone, { capture: true });
    gone.removeEventListener('click', onGone, { capture: true });
    doc.body.append(gone);
    doc.addEventListener('ping', () => {});

    // Malformed ops — the driver logs and skips each instead of throwing.
    pushOp(instance, { t: 'append', parent: 99999, child: 99998 });
    pushOp(instance, { t: 'append', parent: 0, child: 99998 });
    pushOp(instance, { t: 'remove', child: 99998 });
    pushOp(instance, { t: 'update', id: 99999, props: {} });
    pushOp(instance, { t: 'attr', id: 99999, name: 'x', value: 'y' });
    pushOp(instance, { t: 'style', id: 99999, props: {} });
    pushOp(instance, { t: 'listen', id: 99999, type: 'click', handler: 1 });
    pushOp(instance, { t: 'unlisten', id: 99999, type: 'click', handler: 1 });
    pushOp(instance, { t: 'utext', id: 99999, text: 'x' });
  },
});

/**
 * 'rprops' — a React island whose props change shape across updateProps, so
 * the driver's `update` op diffs hit every setProp/removeProp branch:
 * boolean props, the DOM-property fast path, plain-attribute fallback,
 * style-object diffing (incl. key removal), event-ref detach, and
 * prop-carried slots.
 */
function RProps(props: Record<string, unknown>) {
  const phase = Number(props.phase ?? 1);
  return createElement(
    'input',
    {
      'data-atoll-slot': phase < 3 ? 'plug' : undefined,
      onClick: phase < 3 ? () => emit('clicked', { phase }) : undefined,
      className: phase < 3 ? 'ctl' : undefined,
      style:
        phase === 1
          ? { color: 'red', fontSize: '9px' }
          : phase === 2
            ? { color: 'blue' }
            : undefined,
      title: phase < 3 ? 'hint' : undefined,
      'data-extra': phase < 3 ? 'x' : undefined,
      // Boolean props: `checked` on an input — the driver's DOM-property
      // branches (setAttr true/false, removeProp boolean clear).
      checked: phase === 1,
      disabled: phase < 3,
      readOnly: true,
    },
  );
}

/**
 * 'rendered' — a minimal non-React framework app: mount() builds the tree
 * through the proxy document and returns a handle with fine-grained
 * update() and dispose() — the shape Vue/Svelte/Solid/Angular adapters
 * produce. updateProps rides handle.update; unmount rides dispose.
 */
export const renderedApp = islandApp('rendered', {
  mount: (ctx: RenderContext) => {
    const el = ctx.doc.createElement('div');
    el.className = 'rendered';
    el.textContent = `v${String(ctx.props.v ?? '0')}`;
    ctx.doc.body.append(el);
    return {
      update: (props: Record<string, unknown>) => {
        el.textContent = `v${String(props.v)}`;
      },
      dispose: () => {
        el.dataset.disposed = 'yes';
      },
    };
  },
});

/**
 * 'renderednu' — rendered app whose handle has NO update: updateProps must
 * fall back to dispose + clear + re-mount on a fresh document.
 */
export const renderedNoUpdateApp = islandApp('renderednu', {
  mount: (ctx: RenderContext) => {
    const el = ctx.doc.createElement('div');
    el.className = 'rendered-nu';
    el.textContent = `nu-${String(ctx.props.v ?? '0')}`;
    ctx.doc.body.append(el);
    return { dispose() {} };
  },
});

/**
 * 'rsuspend' — a Suspense boundary that suspends on update, exercising the
 * reconciler's hideInstance/hideTextInstance (content hidden while the
 * fallback shows) and unhide on resolve.
 */
let gateResolve: (() => void) | null = null;
let gate: Promise<void> | null = null;
function Suspendable(props: { suspend: boolean }) {
  if (props.suspend) {
    gate ??= new Promise<void>((r) => {
      gateResolve = r;
    });
    use(gate);
  }
  return createElement('div', { className: 'real' }, 'real content');
}
export const suspendControl = {
  release: () => {
    gateResolve?.();
    gate = null;
    gateResolve = null;
  },
};
function RSuspend(props: Record<string, unknown>) {
  return createElement(
    Suspense,
    { fallback: createElement('div', { className: 'fb' }, 'loading') },
    createElement(Suspendable, { suspend: props.suspend === true }),
  );
}

/**
 * 'rportal' — createPortal into a proxy element: exercises the portal
 * container paths (containerParentId/containerInstance on a ProxyElement,
 * insertInContainerBefore, getPublicInstance for the ref).
 */
function RPortal(props: Record<string, unknown>) {
  const [target, setTarget] = useState<unknown>(null);
  const order = String(props.order ?? 'ab');
  const kids = order.split('').map((k) =>
    createElement('li', { key: k }, k),
  );
  return createElement(
    'div',
    { className: 'portal-root' },
    createElement('div', {
      className: 'portal-target',
      ref: (n: unknown) => setTarget(n),
    }),
    createElement('ul', { className: 'reorder' }, kids),
    target !== null
      ? createPortal(
          createElement('span', { className: 'beamed' }, 'beamed'),
          target as never,
        )
      : null,
  );
}

export const perfWorker = definePolyWorker({
  apps: {
    tree: treeApp,
    rtree: reactIslandApp(RTree),
    rcounter: reactIslandApp(RCounter),
    ticker: tickerApp,
    tpl: templateApp,
    cb: callbackApp,
    drive: driverApp,
    rprops: reactIslandApp(RProps),
    rendered: renderedApp,
    renderednu: renderedNoUpdateApp,
    rsuspend: reactIslandApp(RSuspend),
    rportal: reactIslandApp(RPortal),
  },
});
