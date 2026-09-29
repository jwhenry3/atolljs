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
  /**
   * Default true — the client carries a SharedArrayBuffer doorbell for
   * push-mode flush (requires COOP/COEP cross-origin isolation). Pass
   * `false` for a message-only pool: `setMode('push')` falls back to
   * polling and the page needs no special headers.
   */
  doorbell?: boolean;
}

/** One island client: one pool, one worker, one doorbell buffer. */
export const connectIslandWorker = <W extends IslandWorkerDefinition = IslandWorkerDefinition>({
  worker,
  doorbell,
  ...options
}: ConnectIslandWorkerConfig): WorkerClient<W, DoorbellSpec> =>
  connectWorker<W, DoorbellSpec>({
    ...options,
    sharedMemory: doorbell === false ? undefined : makeDoorbell(),
    worker,
    poolSize: 1,
  });

interface MountIslandBaseOptions {
  /** Container element the island's ops are applied into. */
  el: HTMLElement;
  /**
   * Registry app name — a key of the `apps` map passed to
   * `defineIslandWorker`. Optional against a realm worker
   * (`defineRealmWorker`), which resolves its single app regardless.
   */
  app?: string;
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
  /**
   * Perf hook — fired after each op batch is replayed with the batch and the
   * main-thread replay time in ms (performance.now). Pair with client call
   * timing to split worker-vs-main cost for a sub-application.
   */
  onOps?: (ops: readonly Op[], elapsedMs: number) => void;
  /**
   * Initial flush mode — 'push' (default) subscribes the shared-memory
   * doorbell once the mount handshake lands; 'poll' drains committed ops on
   * a 50ms interval. With the `worker` shorthand, 'poll' also builds the
   * client without a doorbell — no SharedArrayBuffer, so no COOP/COEP
   * cross-origin isolation requirement. Switch later with `handle.setMode`.
   */
  mode?: Mode;
  /**
   * Milliseconds the mount handshake (mount + whoami) may take before the
   * returned promise rejects — default 15_000, `0` disables. A worker entry
   * that loads but never answers (no defineIslandWorker/defineRealmWorker
   * call, an import that hangs) otherwise leaves mount pending forever;
   * hard failures (module error, crash) already reject immediately.
   */
  mountTimeout?: number;
}

/**
 * The mount needs one worker-side endpoint: either a `client` a
 * `connectIslandWorker` call produced (shareable — several islands can
 * mount into one worker), or a `worker` entry factory/URL this call builds
 * its own client from (the common one-island-per-worker form — the client
 * is island-internal and dies with `destroy()`).
 */
export type MountIslandOptions = MountIslandBaseOptions &
  (
    | { client: IslandClient; worker?: undefined }
    | (IslandWorkerOptions & { worker: (() => Worker) | URL; client?: undefined })
  );

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
   * Switch how async commits are noticed. The mode given at mount ('push'
   * by default) is started automatically once the handshake lands — call
   * this only to switch modes afterwards. Rebinds of the doorbell contract
   * (in-process harnesses bind every contract on each pool spawn) re-watch
   * transparently.
   */
  setMode(mode: Mode): void;
  /** Manual flush — drains ops committed outside task calls. */
  flush(): Promise<void>;
  /**
   * Stop transport timers/subscriptions and release the realm. When this
   * island owns the client the worker terminates; when the client is shared
   * (several islands mounted into it) the realm unmounts and the worker
   * lives on for its siblings — it dies with the last island to leave.
   */
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

/** Build the wire payload for a DOM event, normalizing missing numeric fields
 *  so worker-side geometry math never receives undefined. */
function buildEventPayload(
  e: Event,
  target: EventTarget | null,
  targetId: number | undefined,
): EventPayload {
  const input = target as HTMLInputElement | null;
  const mouse = e as MouseEvent;
  const wheel = e as WheelEvent;
  const pointer = e as PointerEvent;
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
  return {
    type: e.type,
    value: input && 'value' in input ? input.value : undefined,
    checked: input && 'checked' in input ? input.checked : undefined,
    key: (e as KeyboardEvent).key,
    clientX: coord(mouse.clientX),
    clientY: coord(mouse.clientY),
    screenX: coord(mouse.screenX),
    screenY: coord(mouse.screenY),
    button,
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
    deltaMode:
      num(wheel.deltaMode) ??
      (wheelFam || typeof wheel.deltaX === 'number' || typeof wheel.deltaY === 'number'
        ? 0
        : undefined),
    pointerType: typeof pointer.pointerType === 'string' ? pointer.pointerType : undefined,
    scrollTop: input instanceof HTMLElement ? input.scrollTop : undefined,
    targetId,
  };
}

/** Per-island realm counter — see the realm key note in mountIsland. */
let islandSeq = 0;

/**
 * Live island count per client — a client is shared infrastructure when
 * several islands mount into it (multi-island-per-worker). destroy() gives
 * its realm back via `unmount`; only the LAST island to leave terminates
 * the worker.
 */
const clientMounts = new WeakMap<object, number>();

/* ── Prop serializability ─────────────────────────────────────────────────
 * Props cross to the worker inside a postMessage'd task — a function, DOM
 * node, or other uncloneable value dies in the pool's postMessage call as a
 * bare DataCloneError, far from the caller. Pre-flight the props here so
 * the error names the offending key path. Runs before mount/updateProps;
 * the success path costs one structuredClone (cheap at props sizes). */

const canClone = (v: unknown): boolean => {
  try {
    structuredClone(v);
    return true;
  } catch {
    return false;
  }
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Descend a known-uncloneable value to the first uncloneable leaf's path. */
const uncloneablePath = (value: unknown, path: string): string => {
  const kids: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((v, i) => [`[${i}]`, v])
    : isPlainObject(value)
      ? Object.entries(value)
      : [];
  for (const [k, v] of kids) {
    if (!canClone(v)) {
      const next = path === '' ? k : k.startsWith('[') ? `${path}${k}` : `${path}.${k}`;
      return uncloneablePath(v, next);
    }
  }
  return path;
};

const assertCloneableProps = (props: Record<string, unknown>, context: string): void => {
  if (canClone(props)) return;
  const path = uncloneablePath(props, '');
  throw new Error(
    `[island] ${context}: prop '${path}' is not structured-cloneable — props cross the worker ` +
      'boundary via postMessage. Pass plain data; behavior crosses through emit/onEvent, ' +
      'slots, or a task method on the worker.',
  );
};

export async function mountIsland(opts: MountIslandOptions): Promise<IslandHandle> {
  const {
    el, onEvent, onActivity, onOps, slots, mode: initialMode, mountTimeout,
    client: givenClient, worker, app: givenApp, props: givenProps,
    ...workerConfig
  } = opts;
  const props = givenProps ?? {};
  if (givenClient === undefined && worker === undefined) {
    throw new Error(
      'mountIsland: pass `worker` (a `() => new Worker(...)`/URL entry — this call builds the ' +
        'island-owned client) or `client` (a shared connectIslandWorker — several islands, one worker)',
    );
  }
  const client: IslandClient =
    givenClient ??
    connectIslandWorker({
      ...workerConfig,
      worker,
      // Poll-mode shorthand islands don't need SharedArrayBuffer at all —
      // skip the doorbell contract so the page needs no COOP/COEP headers.
      doorbell: initialMode !== 'poll',
    } as ConnectIslandWorkerConfig);
  assertCloneableProps(props, `mountIsland(${givenApp ?? 'main'})`);
  // 'main' is the unnamed-island name — realm workers (defineRealmWorker)
  // resolve their single app regardless of it.
  const app = givenApp ?? 'main';

  // Realm key = 'app@N' — the instance suffix keeps each island's realm
  // distinct even when several islands mount the SAME microfrontend — in
  // the same worker (shared client) or across workers. Without it, mounting
  // 'data-table' twice into one worker would remount one shared realm
  // instead of giving each island its own (and they would share a pid).
  const realm = `${app}@${++islandSeq}`;
  clientMounts.set(client, (clientMounts.get(client) ?? 0) + 1);

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
  // Element-ness is checked structurally (nodeType 1), never via the global
  // `Element` constructor — in in-process embeddings the worker-side realm
  // dispatcher may have pointed that global at ProxyElement, which would
  // make every `instanceof Element` check silently reject real DOM nodes.
  const isElementNode = (node: Node | undefined): node is Element =>
    node !== undefined && node.nodeType === 1;

  const unmountSlotSubtree = (node: Node): void => {
    if (!isElementNode(node)) return;
    for (const [id, slotEl] of Array.from(slotNodes.entries()).map(([id]) => [id, nodes.get(id)] as const)) {
      if (slotEl === node || node.contains(slotEl as Node)) unmountSlot(id);
    }
  };

  let opsApplied = 0;
  let flushCalls = 0;
  let mode: Mode = initialMode ?? 'push';
  let unsubscribe: (() => void) | null = null;
  let pollTimer: number | null = null;
  let destroyed = false;

  function listenerFor(handlerId: number): EventListener {
    return (e: Event) => {
      const target = e.target;
      const payload = buildEventPayload(
        e,
        target,
        target !== null ? nodeIds.get(target as Node) : undefined,
      );
      // The whole point: an event = one postMessage round-trip. The worker
      // re-renders, we apply whatever ops come back.
      void client
        .dispatch(handlerId, payload)
        .then(applyOps)
        .catch((err) => console.error(`[island ${realm}] dispatch failed`, err));
    };
  }

  // Element-typed, not HTMLElement-typed: createElementNS produces
  // SVGElement/MathMLElement, which share Element's API surface but are NOT
  // HTMLElements — guards and signatures must accept both.
  function setProp(el: Element, id: number, name: string, value: unknown): void {
    if (name === 'data-mesh-slot') {
      mountSlot(el as HTMLElement, id, String(value));
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
      // SVGElement.className is a read-only SVGAnimatedString — assignment
      // throws in strict mode; the class attribute is the portable write.
      if (el instanceof SVGElement) el.setAttribute('class', String(value));
      else el.className = String(value);
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

  function removeProp(el: Element, id: number, name: string, oldValue: unknown): void {
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
      if (el instanceof SVGElement) el.removeAttribute('class');
      else el.className = '';
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

  function applyProps(el: Element, id: number, prev: WireProps, next: WireProps): void {
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
  function setAttr(node: Element, id: number, name: string, value: string | null): void {
    if (name === 'data-mesh-slot') {
      if (value === null) {
        unmountSlot(id);
        node.removeAttribute('data-mesh-slot');
      } else {
        mountSlot(node as HTMLElement, id, value);
      }
      return;
    }
    if (value === null) {
      if (name === 'className') node.className = '';
      else if (name === 'style') node.removeAttribute('style');
      else {
        // Live boolean properties (checked) don't follow attribute
        // removal — mirror removeProp's property clear first.
        if (name in node && typeof (node as unknown as Record<string, unknown>)[name] === 'boolean') {
          (node as unknown as Record<string, unknown>)[name] = false;
        }
        node.removeAttribute(name);
      }
      return;
    }
    if (name === 'class' || name === 'className') {
      if (node instanceof SVGElement) node.setAttribute('class', value);
      else node.className = value;
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
  function mergeStyle(node: Element, id: number, changes: Record<string, string>): void {
    const elStyle = (node as HTMLElement).style;
    const elStyleMap = elStyle as unknown as Record<string, string>;
    const prev = prevProps.get(id) ?? {};
    const merged = { ...((prev.style ?? {}) as Record<string, string>) };
    for (const [k, v] of Object.entries(changes)) {
      if (k.startsWith('--') || k.includes('-')) {
        // Custom properties and kebab-case keys live outside the camelCase
        // property surface — el.style['font-size'] is a silent no-op on real
        // DOM; setProperty accepts kebab-case, and '' clears either kind.
        elStyle.setProperty(k, v);
      } else if (v.endsWith('!important')) {
        // `style.setProperty(k, v, 'important')` crosses as a suffix — the
        // style op has no separate priority channel.
        elStyle.setProperty(k, v.replace(/\s*!important$/, ''), 'important');
      } else {
        elStyleMap[k] = v;
      }
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
        // ns-carrying ops (svg/math) need createElementNS — plain
        // createElement would produce HTMLUnknownElements for <svg> trees.
        const node = op.ns !== undefined
          ? realDocument.createElementNS(op.ns, op.type)
          : realDocument.createElement(op.type);
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
        if (!isElementNode(node)) break;
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
        if (!isElementNode(node)) break;
        setAttr(node, op.id, op.name, op.value);
        break;
      }
      case 'style': {
        const node = nodes.get(op.id);
        if (!isElementNode(node)) break;
        mergeStyle(node, op.id, op.props);
        break;
      }
      case 'listen': {
        const node = nodes.get(op.id);
        if (!isElementNode(node)) break;
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
          node.addEventListener(op.type, listener, op.opts);
        }
        break;
      }
      case 'unlisten': {
        const node = nodes.get(op.id);
        if (!isElementNode(node)) break;
        const key = `${op.type}#${op.handler}`;
        const listener = nodeListeners.get(op.id)?.get(key);
        if (listener) {
          node.removeEventListener(op.type, listener, op.opts?.capture);
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
    const t0 = onOps !== undefined ? performance.now() : 0;
    for (const op of ops) applyOp(op);
    onOps?.(ops, performance.now() - t0);
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

  // Bound the handshake: a worker entry that loads but never answers (no
  // define*Worker call, a hung import) would otherwise pend forever — hard
  // failures already reject via the pool's 'error' handling.
  const mountMs = mountTimeout ?? 15_000;
  const raced = <T>(p: Promise<T>): Promise<T> => {
    if (mountMs <= 0) return p;
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `mountIsland(${app}): the worker never answered within ${mountMs}ms — ` +
                  'check that the entry module loads (bundler path, uncaught import errors) ' +
                  'and calls defineIslandWorker/defineRealmWorker. Pass { mountTimeout: 0 } to disable.',
              ),
            ),
          mountMs,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  };

  let pid: string;
  try {
    applyOps(await raced(client.mount(realm, props)));
    pid = await raced(client.whoami(realm));
  } catch (err) {
    // The realm may exist worker-side with ops we never applied — release it.
    // An island-owned client also terminates (stops a crash→respawn loop on
    // a permanently-broken entry); a shared client just drops the realm.
    clientMounts.set(client, (clientMounts.get(client) ?? 1) - 1);
    if (givenClient === undefined) client.terminate();
    else void client.unmount(realm).catch(() => {});
    throw err;
  }

  // Start the transport now that the handshake landed — 'push' subscribes
  // the doorbell, 'poll' starts the interval. This used to be a manual
  // post-mount ritual; subscriptions now survive contract rebinds.
  setMode(mode);

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
      assertCloneableProps(next, `updateProps(${app})`);
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
      const remaining = (clientMounts.get(client) ?? 1) - 1;
      clientMounts.set(client, remaining);
      if (remaining > 0) {
        // The worker still serves sibling realms — hand this one back. The
        // detach ops are irrelevant if our element is already gone, so the
        // return batch is dropped. Best-effort: the realm map and its
        // handlers release regardless.
        void client.unmount(realm).catch(() => {});
      } else {
        // Last island — still run the realm's teardown first so the app's
        // dispose hook cancels deferred work (library timers, animation
        // loops) and the proxy doc unwinds. In a real worker terminate may
        // kill the thread before unmount lands — equally fine, process
        // death is teardown — but in-process workers need this or the
        // realm zombies on and its pending callbacks mutate foreign docs.
        void client
          .unmount(realm)
          .catch(() => {})
          .finally(() => client.terminate());
      }
    },
  };
  return handle;
}
