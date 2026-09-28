/**
 * Main thread — a dumb op applier. There is NO React on this thread: no
 * renderer, no reconciler, no component code. It creates real DOM nodes when
 * told to, wires DOM events back into the worker as `dispatch` calls, and
 * replays whatever ops come back.
 *
 * poolSize: 1 is REQUIRED — exactly one reconciled tree exists and it lives
 * in one worker's memory. A second worker would emit ops for a different
 * tree with colliding instance ids, and the node map below would corrupt.
 */
import { connectWorker } from '@jwhenry123/mesh/sdk';
import type { RenderWorker } from './worker/render.worker';
import { isEventRef, type EventPayload, type Op, type WireProps } from './ops';

const client = connectWorker<RenderWorker>({
  worker: () =>
    new Worker(new URL('./worker/render.worker.ts', import.meta.url), { type: 'module' }),
  poolSize: 1,
});

/* ── DOM driver ─────────────────────────────────────────────────────────── */

const maybeRoot = document.getElementById('root');
if (!maybeRoot) throw new Error('#root missing from index.html');
const rootEl: HTMLElement = maybeRoot;

/** instance id → live DOM node. Id 0 is the root container sentinel. */
const nodes = new Map<number, Node>([[0, rootEl]]);
/** instance id → last applied prop set (for diffing on `update`). */
const prevProps = new Map<number, WireProps>();
/** instance id → event name → attached listener (kept for removal). */
const nodeListeners = new Map<number, Map<string, EventListener>>();

function listenerFor(handlerId: number): EventListener {
  return (e: Event) => {
    const target = e.target as HTMLInputElement | null;
    const payload: EventPayload = {
      type: e.type,
      value: target && 'value' in target ? target.value : undefined,
      checked: target && 'checked' in target ? target.checked : undefined,
      key: (e as KeyboardEvent).key,
    };
    // The whole point: an event = one postMessage round-trip. The worker
    // re-renders, we apply whatever ops come back.
    void client.dispatch(handlerId, payload).then(applyOps);
  };
}

function setProp(el: HTMLElement, id: number, name: string, value: unknown): void {
  if (isEventRef(value)) {
    const eventName = name.slice(2).toLowerCase();
    let table = nodeListeners.get(id);
    if (!table) nodeListeners.set(id, (table = new Map()));
    if (!table.has(eventName)) {
      // Handler ids are stable per (instance, prop) — attach exactly once.
      const listener = listenerFor(value.__evt);
      table.set(eventName, listener);
      el.addEventListener(eventName, listener);
    }
    return;
  }
  if (name === 'style' && typeof value === 'object' && value !== null) {
    const elStyle = (el as HTMLElement).style as unknown as Record<string, string>;
    const prevStyle = (prevProps.get(id)?.style ?? {}) as Record<string, string>;
    const nextStyle = value as Record<string, string>;
    for (const k of Object.keys(prevStyle)) if (!(k in nextStyle)) elStyle[k] = '';
    for (const [k, v] of Object.entries(nextStyle)) if (prevStyle[k] !== v) elStyle[k] = v;
    return;
  }
  if (name === 'className') {
    el.className = String(value);
    return;
  }
  if (value === true) {
    el.setAttribute(name, '');
    if (name in el) (el as unknown as Record<string, unknown>)[name] = true;
    return;
  }
  if (value === false) {
    el.removeAttribute(name);
    if (name in el) (el as unknown as Record<string, unknown>)[name] = false;
    return;
  }
  // Prefer the DOM property (value, checked, disabled…) when it exists so
  // controlled inputs actually reflect state; fall back to attributes.
  if (name in el) {
    try {
      (el as unknown as Record<string, unknown>)[name] = value;
      return;
    } catch {
      /* read-only property — use the attribute */
    }
  }
  el.setAttribute(name, String(value));
}

function removeProp(el: HTMLElement, id: number, name: string, oldValue: unknown): void {
  if (isEventRef(oldValue)) {
    const eventName = name.slice(2).toLowerCase();
    const listener = nodeListeners.get(id)?.get(eventName);
    if (listener) {
      el.removeEventListener(eventName, listener);
      nodeListeners.get(id)?.delete(eventName);
    }
    return;
  }
  if (name === 'className') {
    el.className = '';
    return;
  }
  if (name === 'style') {
    el.removeAttribute('style');
    return;
  }
  if (name in el && typeof (el as unknown as Record<string, unknown>)[name] === 'boolean') {
    (el as unknown as Record<string, unknown>)[name] = false;
  }
  el.removeAttribute(name);
}

function applyProps(el: HTMLElement, id: number, prev: WireProps, next: WireProps): void {
  for (const name of Object.keys(prev)) {
    if (!(name in next)) removeProp(el, id, name, prev[name]);
  }
  for (const [name, value] of Object.entries(next)) {
    // __evt ids are stable across updates → Object.is equality skips re-attach.
    if (prev[name] !== value || isEventRef(value)) setProp(el, id, name, value);
  }
}

function applyOp(op: Op): void {
  switch (op.t) {
    case 'create': {
      const el = document.createElement(op.type);
      nodes.set(op.id, el);
      prevProps.set(op.id, op.props);
      for (const [name, value] of Object.entries(op.props)) setProp(el, op.id, name, value);
      break;
    }
    case 'text': {
      nodes.set(op.id, document.createTextNode(op.text));
      break;
    }
    case 'append': {
      const parent = nodes.get(op.parent);
      const child = nodes.get(op.child);
      if (!parent || !child) break;
      const before = op.before !== undefined ? (nodes.get(op.before) ?? null) : null;
      parent.insertBefore(child, before);
      break;
    }
    case 'remove': {
      const child = nodes.get(op.child);
      child?.parentNode?.removeChild(child);
      break;
    }
    case 'update': {
      const el = nodes.get(op.id);
      if (!(el instanceof HTMLElement)) break;
      const prev = prevProps.get(op.id) ?? {};
      applyProps(el, op.id, prev, op.props);
      prevProps.set(op.id, op.props);
      break;
    }
    case 'utext': {
      const node = nodes.get(op.id);
      if (node) node.textContent = op.text;
      break;
    }
    case 'clear': {
      rootEl.replaceChildren();
      break;
    }
  }
}

function applyOps(ops: Op[]): void {
  for (const op of ops) applyOp(op);
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  applyOps(await client.mount());

  // Anything committed outside a task call — passive effects, timers, async
  // setState — waits in the worker's op queue until we ask. The pool
  // protocol has no push channel, so poll flush() at a modest cadence.
  setInterval(() => {
    void client.flush().then(applyOps);
  }, 50);
}

void main();
