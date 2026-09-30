/**
 * React-app island worker fixture — `defineReactPolyWorker` maps each entry
 * through `reactIslandApp`, so mounting these apps exercises the reconciler
 * host config (`hostConfig.ts`) end to end through the real op protocol:
 *
 *   'counter' — stateful button + prop-driven label: createInstance,
 *               appendInitialChild, commitUpdate/commitTextUpdate, dispatch
 *               through the handle's `sync` lane, emit.
 *   'list'    — keyed <li> children reordered/removed via updateProps:
 *               insertBefore, removeChild, detachDeletedInstance (the removed
 *               rows carry listeners, so their handler slots unregister), and
 *               a conditional ROOT-level child → removeChildFromContainer.
 *   'svgapp'  — <svg>/<math>/<foreignObject> trees: the host-context
 *               namespace flips in childHostContextFor reach the driver's
 *               createElementNS ops.
 *   'susp'    — Suspense boundary that suspends on UPDATE over a `use()`d
 *               gate: hideInstance/hideTextInstance while the fallback shows,
 *               unhide on resolve. `suspendControl.release()` opens the gate.
 *   'portal'  — ref → createPortal into the proxy element facade:
 *               getPublicInstance + the ProxyElement branches of
 *               containerParentId/containerInstance + insertInContainerBefore
 *               on portal-child reorder; a second portal into an <svg> target
 *               covers getRootHostContext's namespace lookup.
 *   'slotapp' — renders <Slot name="plug"/> (src/slot.tsx): a leaf anchor the
 *               shell fills through `<Island slots>`.
 *   'xcounter'— an islandApp-stamped component wrapped by reactIslandApp:
 *               the stamp survives the wrap (worker.ts's stamp-forwarding).
 *   'boom'    — an IMPERATIVE app sitting in the React poly registry (the
 *               non-function branch of defineReactPolyWorker's mapping); its
 *               build throws on props.boom for mount/update error tests.
 *
 * Component names match their registry keys so the adapter's auto-stamp
 * (islandAppNameOf falls back to function names) doesn't trip
 * definePolyWorker's stamp/key mismatch warning.
 */
import { createElement, useState, Suspense, use, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { emit, islandApp, type ProxyDocument } from '@atolljs/islands/worker';
import { defineReactPolyWorker, Slot } from '../../src/worker';

function counter(props: Record<string, unknown>) {
  const [n, setN] = useState(0);
  return createElement(
    'button',
    {
      className: 'btn',
      onClick: () => {
        setN((c) => c + 1);
        emit('ticked', { n: n + 1 });
      },
    },
    `${String(props.label ?? 'count')}: ${n}`,
  );
}

/** Keyed rows + a conditional root-level sibling — reorder/remove/re-add via props. */
function list(props: Record<string, unknown>) {
  const items = String(props.items ?? 'a,b,c').split(',');
  const showExtra = props.extra === true;
  return createElement(
    'div',
    { className: 'list-root' },
    createElement(
      'ul',
      { className: 'rows' },
      items.map((k) =>
        createElement(
          'li',
          {
            key: k,
            className: 'row',
            'data-k': k,
            // Listeners on rows that get removed — detachDeletedInstance
            // must unregister their handler slots.
            onClick: () => emit('row-clicked', { k }),
          },
          k,
        ),
      ),
    ),
    // A direct child of the root container whose removal exercises
    // removeChildFromContainer.
    showExtra ? createElement('p', { className: 'extra' }, 'extra') : null,
  );
}

function svgapp() {
  return createElement(
    'div',
    { className: 'svg-wrap' },
    createElement(
      'svg',
      { className: 'chart', viewBox: '0 0 10 10' },
      createElement('circle', { className: 'dot', r: 2, cx: 5, cy: 5 }),
      // foreignObject's children flip back to HTML (host-context integration
      // point). NOTE: the element itself is created in the parent context —
      // React DOM keeps <foreignObject> in the SVG namespace; this renderer
      // currently creates it as HTML (see test note).
      createElement(
        'foreignObject',
        { className: 'fo' },
        createElement('p', { className: 'fo-text' }, 'html in svg'),
      ),
    ),
    createElement('math', null, createElement('mi', null, 'x')),
  );
}

/* Suspense gate — resolved from the test via `suspendControl.release()`. */
let gateResolve: (() => void) | null = null;
let gate: Promise<void> | null = null;
export const suspendControl = {
  release: (): void => {
    gateResolve?.();
    gate = null;
    gateResolve = null;
  },
  reset: (): void => {
    gate = null;
    gateResolve = null;
  },
};

function Suspendable(props: { suspend: boolean }) {
  if (props.suspend) {
    gate ??= new Promise<void>((r) => {
      gateResolve = r;
    });
    use(gate);
  }
  return createElement(
    'div',
    { className: 'real' },
    'real content',
    // Bare text sibling — its hide/show goes through
    // hideTextInstance/unhideTextInstance rather than the element ops.
    'tail text',
  );
}

function susp(props: Record<string, unknown>) {
  return createElement(
    Suspense,
    { fallback: createElement('div', { className: 'fb' }, 'loading') },
    createElement(Suspendable, { suspend: props.suspend === true }),
    // Bare text DIRECTLY under the boundary — hideTextInstance/​unhideTextInstance
    // (not hideInstance) govern its visibility.
    'stray text',
  );
}

/** Fragment-rooted app: conditional LEADING container child (insertInContainerBefore)
 *  and a Fragment ref (createFragmentInstance/commitNewChildToFragmentInstance). */
function frag(props: Record<string, unknown>) {
  const lead = props.lead === true;
  return createElement(
    Fragment,
    {
      // React 19 fragment refs — the host config's createFragmentInstance stub.
      ref: (() => {}) as never,
    },
    lead ? createElement('i', { className: 'lead' }, 'lead') : null,
    createElement('b', { className: 'ftail' }, 'tail'),
  );
}

/** Render-throwing component — exercises the reconciler's error path through
 *  mount/updateProps (no error boundary → the task rejects). */
function boomtree(props: Record<string, unknown>) {
  if (props.boom !== false) throw new Error('render exploded');
  return createElement('p', { className: 'tree-ok' }, 'fine');
}

/** Portal app: two createPortal targets — an HTML div and an SVG <g>. */
function portal(props: Record<string, unknown>) {
  const [htmlTarget, setHtmlTarget] = useState<unknown>(null);
  const [svgTarget, setSvgTarget] = useState<unknown>(null);
  const order = String(props.order ?? 'ab').split('');
  return createElement(
    'div',
    { className: 'portal-root' },
    createElement('div', {
      className: 'portal-target',
      ref: (n: unknown) => setHtmlTarget(n),
    }),
    createElement(
      'svg',
      { className: 'portal-svg' },
      createElement('g', { className: 'svg-target', ref: (n: unknown) => setSvgTarget(n) }),
    ),
    htmlTarget !== null
      ? createPortal(
          createElement(
            'ul',
            { className: 'beamed-list' },
            order.map((k) => createElement('li', { key: k, className: 'beamed' }, k)),
          ),
          htmlTarget as never,
        )
      : null,
    svgTarget !== null
      ? createPortal(
          createElement('circle', { className: 'svg-beamed', r: 1 }),
          svgTarget as never,
        )
      : null,
  );
}

/** Slot app — <Slot> renders a leaf data-atoll-slot anchor the shell fills. */
function slotapp(props: Record<string, unknown>) {
  return createElement(
    'div',
    { className: 'slot-app' },
    createElement('p', { className: 'slot-label' }, String(props.label ?? 'slot app')),
    createElement(Slot, { name: 'plug' }),
  );
}

/** Stamped component — reactIslandApp must keep its islandAppName. */
const StampedCounter = islandApp('xcounter', function xcounter(props: { label?: string }) {
  return createElement('p', { className: 'xecho' }, String(props.label ?? 'x'));
});

/** Imperative app sharing the React registry — build throws on props.boom. */
export const boomApp = islandApp('boom', {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    if (props.boom === true) throw new Error('boom app exploded');
    const p = doc.createElement('p');
    p.className = 'boom-ok';
    p.textContent = String(props.text ?? 'stable');
    doc.body.append(p);
  },
});

export const reactWorker = defineReactPolyWorker({
  apps: {
    counter,
    list,
    svgapp,
    susp,
    portal,
    slotapp,
    frag,
    boomtree,
    xcounter: StampedCounter,
    boom: boomApp,
  },
});
