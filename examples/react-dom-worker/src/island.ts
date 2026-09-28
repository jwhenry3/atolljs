/**
 * Per-island mounter — the main-thread half of one React tree in one worker.
 *
 * `mountIsland` does everything the old main.ts did for the single tree, but
 * scoped so several islands can coexist on one page: each island gets its own
 * `connectWorker` client (own pool of ONE worker, own doorbell buffer via
 * `makeDoorbell()`), its own nodes/props/listeners maps (op ids are only
 * unique within a worker — sharing maps between islands would corrupt them),
 * and its own `onEvent` sink for `emit` ops.
 *
 * There is still NO React on this thread — the driver below just replays ops.
 *
 * poolSize: 1 is REQUIRED per island — the reconciled tree lives in one
 * worker's memory. A real pool can't serve islands today anyway: task routing
 * is least-busy round-robin, so a second worker would receive dispatches for
 * a tree it doesn't hold (sticky routing is future work — see README).
 */
import { connectWorker, observe } from '@jwhenry123/mesh/sdk';
import type { ConnectWorkerConfig, SharedSpec } from '@jwhenry123/mesh/sdk';
import { makeDoorbell } from './memory';
import { isEventRef, type EventPayload, type Op, type WireProps } from './ops';
import type { RenderWorker } from './worker/render.worker';

export type Mode = 'push' | 'poll';

/**
 * Islands are microfrontend containers: each owns ONE worker holding ONE
 * reconciled tree, so pooling is disabled by construction — the type omits
 * `poolSize`/`worker`/`sharedMemory` (all island-internal) and the literal
 * below pins `poolSize: 1` after the spread, so a wider pool can't sneak
 * through a cast either. What remains configurable (concurrency, taskTimeout,
 * respawn, lazy…) still passes through.
 */
export type IslandWorkerOptions = Omit<
  ConnectWorkerConfig<SharedSpec>,
  'sharedMemory' | 'worker' | 'poolSize'
>;

/** One island client: one pool, one worker, one doorbell buffer. */
export const connectIslandWorker = (options: IslandWorkerOptions = {}) =>
  connectWorker<RenderWorker>({
    ...options,
    sharedMemory: makeDoorbell(),
    worker: () =>
      new Worker(new URL('./worker/render.worker.ts', import.meta.url), { type: 'module' }),
    poolSize: 1,
  });

export type IslandClient = ReturnType<typeof connectIslandWorker>;

export interface MountIslandOptions {
  client: IslandClient;
  /** Container element the island's ops are applied into. */
  el: HTMLElement;
  /** Registry app name — 'controls' | 'data-table' | 'stats'. */
  app: string;
  props?: Record<string, unknown>;
  /** Island → shell channel: receives every `emit` op the app produces. */
  onEvent?: (name: string, payload: unknown) => void;
  /** Fired after each applied op batch — the shell uses it for stats. */
  onActivity?: () => void;
}

export interface IslandHandle {
  readonly app: string;
  /** The worker-side realm's random id — proof each island is a distinct worker. */
  readonly pid: string;
  readonly mode: Mode;
  opsApplied: number;
  flushCalls: number;
  /** Re-render the island's root with new serializable props. */
  updateProps(props: Record<string, unknown>): Promise<void>;
  /**
   * Switch how async commits are noticed. Call AFTER every island is
   * mounted — in the browser each island's doorbell contract is bound to its
   * own pool buffer, but under the in-process test harness all contracts end
   * up bound to the last pool's buffer, so subscribing early can pin a stale
   * doorbell.
   */
  setMode(mode: Mode): void;
  /** Manual flush — drains ops committed outside task calls. */
  flush(): Promise<void>;
  /** Stop transport timers/subscriptions and terminate the worker. */
  destroy(): void;
}

/* ── DOM driver (per island) ────────────────────────────────────────────── */

/** Per-island realm counter — see the realm key note in mountIsland. */
let islandSeq = 0;

export async function mountIsland(opts: MountIslandOptions): Promise<IslandHandle> {
  const { client, el, app, onEvent, onActivity } = opts;
  const props = opts.props ?? {};

  // Realm key = 'app@N' — the instance suffix keeps each island's realm
  // distinct even when several islands mount the SAME microfrontend. In
  // production each worker holds one realm anyway so the suffix is
  // inert, but under the in-process test one module plays every worker —
  // without it, mounting 'data-table' twice would remount one shared realm
  // instead of giving each island its own (and they would share a pid).
  const realm = `${app}@${++islandSeq}`;

  /** instance id → live DOM node. Id 0 is the root container sentinel. */
  const nodes = new Map<number, Node>([[0, el]]);
  /** instance id → last applied prop set (for diffing on `update`). */
  const prevProps = new Map<number, WireProps>();
  /** instance id → event name → attached listener (kept for removal). */
  const nodeListeners = new Map<number, Map<string, EventListener>>();

  let opsApplied = 0;
  let flushCalls = 0;
  let mode: Mode = 'push';
  let unsubscribe: (() => void) | null = null;
  let pollTimer: number | null = null;
  let destroyed = false;

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
        const node = document.createElement(op.type);
        nodes.set(op.id, node);
        prevProps.set(op.id, op.props);
        for (const [name, value] of Object.entries(op.props)) setProp(node, op.id, name, value);
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
        const node = nodes.get(op.id);
        if (!(node instanceof HTMLElement)) break;
        const prev = prevProps.get(op.id) ?? {};
        applyProps(node, op.id, prev, op.props);
        prevProps.set(op.id, op.props);
        break;
      }
      case 'utext': {
        const node = nodes.get(op.id);
        if (node) node.textContent = op.text;
        break;
      }
      case 'clear': {
        // React emits clearContainer inside the SAME commit batch that then
        // appends the new tree (initial mounts and remounts both) — so the
        // node maps must survive this op: the following `append` still needs
        // the ids it just created. Stale ids are never reused; the only cost
        // is a few dead map entries on remount.
        el.replaceChildren();
        break;
      }
      case 'emit': {
        // Not a DOM mutation — the island→shell channel.
        onEvent?.(op.name, op.payload);
        break;
      }
    }
  }

  function applyOps(ops: Op[]): void {
    opsApplied += ops.length;
    onActivity?.();
    for (const op of ops) applyOp(op);
  }

  const doFlush = (): void => {
    if (destroyed) return;
    flushCalls++;
    void client.flush(realm).then(applyOps);
  };

  /* ── Transport: push (shared-memory doorbell) vs poll ─────────────────── */

  // The doorbell — opsVersion bumps once per commit in this island's worker;
  // observe() wakes via Atomics.waitAsync, so worker-initiated commits arrive
  // as a push instead of waiting on a poll tick. Subscribed lazily in
  // setMode() — see the note on IslandHandle.setMode about bind ordering.
  const doorbell = client.sharedMemory ? observe(client.sharedMemory, 'opsVersion') : null;

  function setMode(next: Mode): void {
    mode = next;
    unsubscribe?.();
    unsubscribe = null;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (mode === 'push' && doorbell !== null) unsubscribe = doorbell.subscribe(doFlush);
    else pollTimer = window.setInterval(doFlush, 50);
    onActivity?.();
  }

  /* ── Mount ────────────────────────────────────────────────────────────── */

  applyOps(await client.mount(realm, props));
  const pid = await client.whoami(realm);

  const handle: IslandHandle = {
    app,
    pid,
    get mode() {
      return mode;
    },
    get opsApplied() {
      return opsApplied;
    },
    get flushCalls() {
      return flushCalls;
    },
    setMode,
    updateProps: async (next: Record<string, unknown>) => {
      applyOps(await client.updateProps(realm, next));
    },
    flush: async () => {
      applyOps(await client.flush(realm));
    },
    destroy: () => {
      destroyed = true;
      unsubscribe?.();
      if (pollTimer !== null) clearInterval(pollTimer);
      client.terminate();
    },
  };
  return handle;
}
