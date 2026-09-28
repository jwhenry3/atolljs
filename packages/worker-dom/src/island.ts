/**
 * Per-island mounter — the main-thread half of one React tree in one worker.
 *
 * `mountIsland` mounts one island scoped so several can coexist on one page:
 * each island gets its own `connectWorker` client (own pool of ONE worker,
 * own doorbell buffer via `makeDoorbell()`), its own nodes/props/listeners
 * maps (op ids are only unique within a worker — sharing maps between
 * islands would corrupt them), and its own `onEvent` sink for `emit` ops.
 *
 * There is no React on this thread — the driver below just replays ops.
 *
 * poolSize: 1 is REQUIRED per island — the reconciled tree lives in one
 * worker's memory. A real pool can't serve islands today anyway: task routing
 * is least-busy round-robin, so a second worker would receive dispatches for
 * a tree it doesn't hold (sticky routing is future work).
 */
import { connectWorker, observe } from '@jwhenry123/mesh/sdk';
import type {
  ConnectWorkerConfig,
  SharedSpec,
  WorkerClient,
  WorkerDefinition,
} from '@jwhenry123/mesh/sdk';
import { makeDoorbell, type DoorbellSpec } from './memory';
import {
  isEventRef,
  type EventPayload,
  type IslandWorkerMethods,
  type Op,
  type WireProps,
} from './ops';

export type Mode = 'push' | 'poll';

/** The worker definition every `defineIslandWorker` call produces. */
export type IslandWorkerDefinition = WorkerDefinition<DoorbellSpec, IslandWorkerMethods>;

/** One island client: one pool, one worker, one doorbell buffer. */
export type IslandClient = WorkerClient<IslandWorkerDefinition, DoorbellSpec>;

/**
 * Islands are microfrontend containers: each owns ONE worker holding ONE
 * reconciled tree, so pooling is disabled by construction — the type omits
 * `poolSize`/`worker`/`sharedMemory` (all island-internal) and the literal
 * below pins `poolSize: 1` after the spread, so a wider pool can't sneak
 * through a cast either. `worker` is supplied per call — the package can't
 * know where the consumer's worker entry lives — everything else
 * (concurrency, taskTimeout, respawn, lazy…) still passes through.
 */
export type IslandWorkerOptions = Omit<
  ConnectWorkerConfig<SharedSpec>,
  'sharedMemory' | 'worker' | 'poolSize'
>;

export interface ConnectIslandWorkerConfig extends IslandWorkerOptions {
  /**
   * Bundler-detectable factory `() => new Worker(new URL('./x.worker.ts',
   * import.meta.url), { type: 'module' })`, or a URL. The worker script must
   * call `defineIslandWorker({ apps })` from '@jwhenry123/mesh-worker-dom/worker'.
   */
  worker: (() => Worker) | URL;
}

/** One island client: one pool, one worker, one doorbell buffer. */
export const connectIslandWorker = <W extends IslandWorkerDefinition = IslandWorkerDefinition>({
  worker,
  ...options
}: ConnectIslandWorkerConfig): WorkerClient<W, DoorbellSpec> =>
  connectWorker<W, DoorbellSpec>({
    ...options,
    sharedMemory: makeDoorbell(),
    worker,
    poolSize: 1,
  });

export interface MountIslandOptions {
  client: IslandClient;
  /** Container element the island's ops are applied into. */
  el: HTMLElement;
  /** Registry app name — a key of the `apps` map passed to defineIslandWorker. */
  app: string;
  props?: Record<string, unknown>;
  /** Island → shell channel: receives every `emit` op the app produces. */
  onEvent?: (name: string, payload: unknown) => void;
  /**
   * Transclusion slots — worker markup renders `<div data-mesh-slot="name">`
   * as a LEAF; when its create op lands, the real element is handed to
   * `slots[name](el)` so the shell can mount main-thread content inside it
   * (a widget, a canvas, even a main-thread React root — real DOM, real
   * events, zero wire). Called again with `null` when the worker removes or
   * renames the element, so the shell can tear down. The element itself
   * stays worker-owned — its box/layout props apply normally.
   */
  slots?: Record<string, (el: HTMLElement | null) => void>;
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

/**
 * Event types whose real DOM objects always carry numeric pointer fields
 * (MouseEvent and its subclasses — WheelEvent, DragEvent, PointerEvent) —
 * used by listenerFor to normalize absent coords to 0, and by the wheel
 * families for delta fields. `instanceof` checks in listenerFor catch
 * event objects with exotic type names.
 */
const POINTER_FAMILY =
  /^(mouse|pointer|drag|drop|wheel|mousewheel|DOMMouseScroll|click|dblclick|auxclick|contextmenu|selectstart|gotpointercapture|lostpointercapture)/;
const WHEEL_FAMILY = /^(wheel|mousewheel|DOMMouseScroll)$/;

/** Per-island realm counter — see the realm key note in mountIsland. */
let islandSeq = 0;

export async function mountIsland(opts: MountIslandOptions): Promise<IslandHandle> {
  const { client, el, app, onEvent, onActivity, slots } = opts;
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
  /** live DOM node → instance id — fills EventPayload.targetId. */
  const nodeIds = new WeakMap<Node, number>([[el, 0]]);
  /** instance id → last applied prop set (for diffing on `update`). */
  const prevProps = new Map<number, WireProps>();
  /** instance id → event name → attached listener (kept for removal). */
  const nodeListeners = new Map<number, Map<string, EventListener>>();
  /** instance id → slot name, for elements carrying `data-mesh-slot`. */
  const slotNodes = new Map<number, string>();

  /** Hand a live element to its slot mount callback (or drop it silently). */
  const mountSlot = (node: HTMLElement, id: number, name: string): void => {
    // Always set the attribute — nested-remove detection below finds slot
    // elements inside detached subtrees by querying for it.
    node.setAttribute('data-mesh-slot', name);
    const prev = slotNodes.get(id);
    if (prev !== undefined && prev !== name) opts.slots?.[prev]?.(null);
    slotNodes.set(id, name);
    slots?.[name]?.(node);
  };

  const unmountSlot = (id: number): void => {
    const name = slotNodes.get(id);
    if (name !== undefined) {
      slots?.[name]?.(null);
      slotNodes.delete(id);
    }
  };

  /** Unmount every slot inside a detached subtree (React removes whole
   *  subtrees with ONE `remove` op — a slot deep inside gets no op of its
   *  own). Elements created by ops are the only things in the tree, so a
   *  DOM query for the marker attribute is exact. */
  const unmountSlotSubtree = (node: Node): void => {
    if (!(node instanceof HTMLElement)) return;
    for (const [id, slotEl] of Array.from(slotNodes.entries()).map(([id]) => [id, nodes.get(id)] as const)) {
      if (slotEl === node || node.contains(slotEl as Node)) unmountSlot(id);
    }
  };

  let opsApplied = 0;
  let flushCalls = 0;
  let mode: Mode = 'push';
  let unsubscribe: (() => void) | null = null;
  let pollTimer: number | null = null;
  let destroyed = false;

  function listenerFor(handlerId: number): EventListener {
    return (e: Event) => {
      const target = e.target as HTMLInputElement | null;
      const mouse = e as MouseEvent;
      const wheel = e as WheelEvent;
      const pointer = e as PointerEvent;
      // Real DOM guarantees numeric pointer fields on every MouseEvent-
      // family object — WheelEvent, DragEvent, PointerEvent included. An
      // environment that under-fills them (happy-dom's WheelEvent extends
      // UIEvent and has NO clientX at all) would otherwise ship `undefined`
      // across the wire, and worker-side geometry math — Leaflet's
      // `e.clientX - offset.left` in getMousePosition — turns undefined
      // into NaN coordinates and throws. For those event types the wire
      // always carries numbers: absent fields default to 0, matching what
      // the real DOM reports for a pointer at the origin.
      const pointerFam =
        POINTER_FAMILY.test(e.type) ||
        (typeof MouseEvent !== 'undefined' && e instanceof MouseEvent);
      const wheelFam =
        WHEEL_FAMILY.test(e.type) ||
        (typeof WheelEvent !== 'undefined' && e instanceof WheelEvent);
      const num = (v: unknown): number | undefined =>
        typeof v === 'number' ? v : undefined;
      const coord = (v: unknown): number | undefined =>
        num(v) ?? (pointerFam ? 0 : undefined);
      const button = num(mouse.button) ?? (pointerFam ? 0 : undefined);
      const payload: EventPayload = {
        type: e.type,
        value: target && 'value' in target ? target.value : undefined,
        checked: target && 'checked' in target ? target.checked : undefined,
        key: (e as KeyboardEvent).key,
        // Best-effort enrichment: mouse coords/button, wheel deltas,
        // pointerType, the target's scroll offset, and the instance id of
        // the target when it's an op-created node (shell DOM has no id).
        clientX: coord(mouse.clientX),
        clientY: coord(mouse.clientY),
        screenX: coord(mouse.screenX),
        screenY: coord(mouse.screenY),
        button,
        // `which` is non-standard but browsers compute it as button+1 on
        // mouse events; environments that don't expose it (and libs like
        // Leaflet that gate drags on `e.which === 1`) get the same value.
        which:
          typeof mouse.which === 'number' && mouse.which !== 0
            ? mouse.which
            : button !== undefined
              ? button + 1
              : undefined,
        shiftKey: typeof mouse.shiftKey === 'boolean' ? mouse.shiftKey : undefined,
        ctrlKey: typeof mouse.ctrlKey === 'boolean' ? mouse.ctrlKey : undefined,
        altKey: typeof mouse.altKey === 'boolean' ? mouse.altKey : undefined,
        metaKey: typeof mouse.metaKey === 'boolean' ? mouse.metaKey : undefined,
        deltaX: num(wheel.deltaX) ?? (wheelFam ? 0 : undefined),
        deltaY: num(wheel.deltaY) ?? (wheelFam ? 0 : undefined),
        // WheelEvent.deltaMode is always a real number in browsers; when an
        // environment leaves it undefined but deltas exist, normalize to
        // 0 (pixels) so worker-side wheel math (Leaflet's getWheelDelta
        // checks `deltaMode === 0`) behaves like the real DOM.
        deltaMode:
          num(wheel.deltaMode) ??
          (wheelFam || typeof wheel.deltaX === 'number' || typeof wheel.deltaY === 'number'
            ? 0
            : undefined),
        pointerType: typeof pointer.pointerType === 'string' ? pointer.pointerType : undefined,
        scrollTop: target instanceof HTMLElement ? target.scrollTop : undefined,
        targetId: target ? nodeIds.get(target) : undefined,
      };
      // The whole point: an event = one postMessage round-trip. The worker
      // re-renders, we apply whatever ops come back.
      void client
        .dispatch(handlerId, payload)
        .then(applyOps)
        .catch((err) => console.error(`[island ${realm}] dispatch failed`, err));
    };
  }

  function setProp(el: HTMLElement, id: number, name: string, value: unknown): void {
    if (name === 'data-mesh-slot') {
      mountSlot(el, id, String(value));
      return;
    }
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
    if (name === 'data-mesh-slot') {
      unmountSlot(id);
      el.removeAttribute('data-mesh-slot');
      return;
    }
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

  /**
   * The `attr` op — the proxy DOM's setAttribute/removeAttribute channel.
   * Values are always strings (or null to remove): the worker-side facade
   * only knows attributes. Reuses setProp's heuristics where they apply —
   * `data-mesh-slot` routes to the slot machinery, `class`/`className` land
   * on the property, other names prefer a DOM property when one exists
   * (`id`, `value`) and fall back to the attribute.
   */
  function setAttr(node: HTMLElement, id: number, name: string, value: string | null): void {
    if (name === 'data-mesh-slot') {
      if (value === null) {
        unmountSlot(id);
        node.removeAttribute('data-mesh-slot');
      } else {
        mountSlot(node, id, value);
      }
      return;
    }
    if (value === null) {
      if (name === 'className') node.className = '';
      else if (name === 'style') node.removeAttribute('style');
      else node.removeAttribute(name);
      return;
    }
    if (name === 'class' || name === 'className') {
      node.className = value;
      return;
    }
    if (name === 'style') {
      node.setAttribute('style', value);
      return;
    }
    if (name in node) {
      try {
        (node as unknown as Record<string, unknown>)[name] = value;
        return;
      } catch {
        /* read-only property — use the attribute */
      }
    }
    node.setAttribute(name, value);
  }

  /**
   * The `style` op — incremental inline-style changes from the proxy DOM's
   * style Proxy. Only changed keys arrive; '' clears a key. The merged set
   * is written back into prevProps so a later React `update` style-diff
   * sees these keys as "prev" and still diffs correctly.
   */
  function mergeStyle(node: HTMLElement, id: number, changes: Record<string, string>): void {
    const elStyle = node.style as unknown as Record<string, string>;
    const prev = prevProps.get(id) ?? {};
    const merged = { ...((prev.style ?? {}) as Record<string, string>) };
    for (const [k, v] of Object.entries(changes)) {
      elStyle[k] = v;
      merged[k] = v;
    }
    prev.style = merged;
    prevProps.set(id, prev);
  }

  /* The island's real DOM lives in the container's own document — NOT the
   * ambient `document` global. In in-process tests (and any same-realm
   * embedding) the worker-side installDomShim swaps globalThis.document for
   * a proxy document; el.ownerDocument is immune. */
  const realDocument = el.ownerDocument ?? document;

  function applyOp(op: Op): void {
    switch (op.t) {
      case 'create': {
        const node = realDocument.createElement(op.type);
        nodes.set(op.id, node);
        nodeIds.set(node, op.id);
        prevProps.set(op.id, op.props);
        for (const [name, value] of Object.entries(op.props)) setProp(node, op.id, name, value);
        break;
      }
      case 'text': {
        const node = realDocument.createTextNode(op.text);
        nodes.set(op.id, node);
        nodeIds.set(node, op.id);
        break;
      }
      case 'append': {
        const parent = nodes.get(op.parent);
        const child = nodes.get(op.child);
        if (!parent || !child) {
          console.error(`[island] append skipped: parent=${op.parent}→${String(parent)} child=${op.child}→${String(child)}`);
          break;
        }
        const before = op.before !== undefined ? (nodes.get(op.before) ?? null) : null;
        parent.insertBefore(child, before);
        break;
      }
      case 'remove': {
        const child = nodes.get(op.child);
        if (child !== undefined) unmountSlotSubtree(child);
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
      case 'attr': {
        const node = nodes.get(op.id);
        if (!(node instanceof HTMLElement)) break;
        setAttr(node, op.id, op.name, op.value);
        break;
      }
      case 'style': {
        const node = nodes.get(op.id);
        if (!(node instanceof HTMLElement)) break;
        mergeStyle(node, op.id, op.props);
        break;
      }
      case 'listen': {
        const node = nodes.get(op.id);
        if (!(node instanceof HTMLElement)) break;
        // Keyed by type + handler id so proxy listeners can't collide with
        // the React-prop listener for the same event name, and so unlisten
        // detaches exactly the pair addEventListener created. Id 0 is the
        // island's container — where document/window listeners land, so
        // delegated handlers see every bubbling event inside the island.
        const key = `${op.type}#${op.handler}`;
        let table = nodeListeners.get(op.id);
        if (!table) nodeListeners.set(op.id, (table = new Map()));
        if (!table.has(key)) {
          const listener = listenerFor(op.handler);
          table.set(key, listener);
          node.addEventListener(op.type, listener);
        }
        break;
      }
      case 'unlisten': {
        const node = nodes.get(op.id);
        if (!(node instanceof HTMLElement)) break;
        const key = `${op.type}#${op.handler}`;
        const listener = nodeListeners.get(op.id)?.get(key);
        if (listener) {
          node.removeEventListener(op.type, listener);
          nodeListeners.get(op.id)?.delete(key);
        }
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

  /* ── Pushed-size channel ─────────────────────────────────────────────────
   *
   * The proxy DOM's only geometry is the box THIS element renders — so the
   * driver measures it and pushes {w,h} into the realm via setSize: once
   * immediately (the app's first size-aware work happens then — mount()
   * itself ran before any size existed), and on every ResizeObserver tick
   * throttled to ~100ms (trailing, plus a leading call when the window is
   * quiet). Pushed ops from onResize handlers ride back in the task's
   * return value like dispatch() results.
   */
  let sizeTimer: number | null = null;
  let sizeLastPush = -Infinity;
  let lastW = -1;
  let lastH = -1;
  const pushSize = (): void => {
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    void client.setSize(realm, w, h).then(applyOps);
  };
  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          const now = Date.now();
          const elapsed = now - sizeLastPush;
          if (elapsed >= 100) {
            sizeLastPush = now;
            pushSize();
          } else if (sizeTimer === null) {
            sizeTimer = window.setTimeout(() => {
              sizeTimer = null;
              sizeLastPush = Date.now();
              pushSize();
            }, 100 - elapsed);
          }
        })
      : null;
  resizeObserver?.observe(el);
  sizeLastPush = Date.now();
  pushSize();

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
      resizeObserver?.disconnect();
      if (pollTimer !== null) clearInterval(pollTimer);
      if (sizeTimer !== null) clearTimeout(sizeTimer);
      client.terminate();
    },
  };
  return handle;
}
