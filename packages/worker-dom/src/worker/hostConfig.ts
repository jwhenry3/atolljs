/**
 * The host config that lets react-reconciler run with no DOM at all.
 *
 * "Host instances" are plain records in a Map — `{ kind:'element', id, type }`
 * or `{ kind:'text', id, text }`. Every render-phase and mutation-phase hook
 * the reconciler calls appends a serialized {@link Op} to a queue; the task
 * methods created by `defineIslandWorker` flush that queue back to the main
 * thread, which replays the ops as real DOM mutations. The reconciler itself
 * never touches `document`, `window`, or `self.postMessage` — that is the
 * point of the pattern: React's render logic is DOM-free.
 *
 * react-reconciler@0.34 reads ~150 fields off the config object. Most are
 * stubs for features this renderer doesn't implement (hydration,
 * persistence, resources, singletons, view transitions, test selectors,
 * scope/hydratable APIs) — they exist so nothing throws when the reconciler
 * destructures them; they are never invoked behind the `supports*` flags.
 *
 * REALMS: one worker script hosts an app registry — in production each
 * island's worker mounts exactly one app, but the in-process test runs every
 * island against a single module instance, so state that must not bleed
 * between islands is keyed by app name ("realm"): each instance records the
 * realm it was created under, and structural ops route to that instance's
 * realm queue. Task methods wrap their work in {@link setActiveRealm} so
 * instance-less ops (`clear`, `emit`) land on the right queue too.
 */

import { createContext } from 'react';
import { renderMemory } from '../memory';
import type { Op, WireProps } from '../ops';
import { realmDocFor, type ProxyNode } from './proxyDom';

/* ── Host instances ─────────────────────────────────────────────────────── */

export interface ElementInstance {
  kind: 'element';
  id: number;
  type: string;
  /** Which mounted app this node belongs to — routes its ops. */
  realm: string;
  /** Namespace URI for non-HTML elements (svg/mathml) — rides the `create`
   *  op so the driver uses `createElementNS`. Tracked via host context. */
  ns?: string;
  /** Last serialized prop set — needed so hide/unhide can resend it. */
  props: WireProps;
  /** propName → stable handler id (keeps DOM listeners stable across updates). */
  listenerSlots: Record<string, number>;
}

export interface TextInstance {
  kind: 'text';
  id: number;
  text: string;
  realm: string;
}

export type HostInstance = ElementInstance | TextInstance;

/** The root container is a sentinel — op `parent: 0` means "the root".
 *  defineIslandWorker stamps `realm` on the container it hands
 *  createContainer, so createInstance can bind every element to the realm
 *  that rendered it — deterministic even when a commit runs outside a realm
 *  task (passive-effect renders, scheduler flushes), where activeRealm is
 *  ''. Instance-bound ops then always reach their island's queue. */
export interface RootContainer {
  id: 0;
  realm?: string;
}
export const ROOT_CONTAINER = Object.freeze({ id: 0 }) as RootContainer;

/* ── Per-realm op queues + instance/handler tables ──────────────────────── */

/** realm (app name) → queued ops. Each island flushes only its own queue. */
const opsByRealm = new Map<string, Op[]>();
/** The realm a task is currently executing under — see setActiveRealm. */
let activeRealm = '';
/**
 * instance id → host record. Exported so the proxy DOM (worker/proxyDom.ts)
 * shares the SAME instance space as the reconciler: a proxy-created element
 * can nest inside a React-rendered parent and vice versa, because ops are
 * id-addressed and ids come from one counter.
 */
export const instances = new Map<number, HostInstance>();
interface HandlerEntry {
  fn: (payload: unknown) => void;
  realm: string;
  /** The element this handler was attached to — the event's currentTarget. */
  instanceId?: number;
}
/** handler id → prop function + owning realm. Lives worker-side; never serialized. */
const handlers = new Map<number, HandlerEntry>();
let nextId = 1;
let nextHandlerId = 1;

/** Allocate an instance id — the shared counter React and the proxy DOM both draw from. */
export const allocId = (): number => nextId++;

/**
 * Marks which realm the currently-running task belongs to; returns the
 * previous value for restore. Structural ops don't need it — they route by
 * their instance's realm — but instance-less ops (`clear`, `emit`) and
 * handler dispatch do. Worker tasks run synchronously, so a single pointer
 * is safe even when several realms coexist in one module.
 */
let lastRealm = '';
export const setActiveRealm = (realm: string): string => {
  const prev = activeRealm;
  activeRealm = realm;
  if (realm !== '') lastRealm = realm;
  return prev;
};

/** The realm the current task is running under — '' outside a realm task. */
export const getActiveRealm = (): string => activeRealm;

/**
 * The most recent realm a task ran under — used by the realm dispatcher to
 * route deferred library work (timers, promise continuations) to the right
 * document when several realms share one module (in-process tests).
 */
export const getLastActiveRealm = (): string => lastRealm;

/**
 * Marks `realm` as the ambient realm for out-of-task readers (timers,
 * continuations, shim consumers outside realm work). Called by
 * installDomShim so its document becomes the ambient document.
 */
export const markRealmActive = (realm: string): void => {
  if (realm) lastRealm = realm;
};

/**
 * Run `fn` while `realm` is the active realm — the imperative-code twin of
 * the reconciler's syncCommit wrapper. Imperative DOM writes (`emit`, the
 * proxy DOM's `emit` calls, `clear`) only route correctly while a realm
 * task holds the active realm: mount, updateProps, and dispatch all wrap
 * their work in this, and imperative apps should do the same for any
 * worker-initiated work (timers, promise continuations).
 */
export const runInRealm = <T>(realm: string, fn: () => T): T => {
  const prev = setActiveRealm(realm);
  try {
    return fn();
  } finally {
    setActiveRealm(prev);
  }
};

/** Queue an op onto a realm's queue — instance-bound ops pass their
 *  instance's realm, instance-less ops (`clear`, `emit`) the active one. */
export const pushOp = (realm: string, op: Op): void => {
  let queue = opsByRealm.get(realm);
  if (!queue) opsByRealm.set(realm, (queue = []));
  queue.push(op);
};

/** The minimum surface `bumpOpsVersion` needs off the doorbell contract. */
interface DoorbellContract {
  readonly bound: boolean;
  connector(path: string): { read(): unknown; write(v: unknown): void };
}

/**
 * The contract `bumpOpsVersion` writes to — `renderMemory` by default, or
 * whatever doorbell-shaped contract `defineIslandWorker({ sharedMemory })`
 * was handed. Overriding requires the SAME spec as the main-side
 * `makeDoorbell()` (the pool sizes the buffer for it), so this is a rarely
 * needed escape hatch, not a general field contract.
 */
let doorbell: DoorbellContract = renderMemory;

/** Point the doorbell writes at a different doorbell-spec contract. */
export const setDoorbellContract = (contract: DoorbellContract): void => {
  doorbell = contract;
};

/**
 * The doorbell write resetAfterCommit performs, exported so non-React op
 * producers (the proxy DOM) can ring it too — a commit made outside any
 * task still needs to wake the island's observe() loop. No-op while the
 * contract is unbound (before the pool's INIT_MEMORY handshake).
 */
export const bumpOpsVersion = (): void => {
  if (!doorbell.bound) return;
  const bell = doorbell.connector('opsVersion');
  bell.write(Number(bell.read() ?? 0) + 1);
};

/** Drain one realm's queued ops — called by the worker's task methods. */
export const takeOps = (realm: string): Op[] => {
  const queue = opsByRealm.get(realm);
  if (!queue || queue.length === 0) return [];
  opsByRealm.set(realm, []);
  return queue;
};

export const getHandler = (id: number): HandlerEntry | undefined => handlers.get(id);

/* ── Pushed container size (setSize channel) ────────────────────────────── */

/**
 * realm key → the island container's last measured {w,h}, pushed by the
 * driver's `setSize` task. This is the ONLY geometry channel: the main
 * thread can only measure the island's root box, so the proxy DOM serves
 * this value to `doc.body`/`documentElement` and to elements explicitly
 * marked `doc.markContainer(el)` — every other element keeps the honest 0.
 * Module-level (not per-document) so it survives imperative rebuilds that
 * swap in a fresh proxy document.
 */
const realmSizes = new Map<string, { w: number; h: number }>();

/** The realm's last pushed container size, or undefined if none arrived. */
export const getRealmSize = (realm: string): { w: number; h: number } | undefined =>
  realmSizes.get(realm);

/** Store the container size a `setSize` task pushed. */
export const setRealmSize = (realm: string, w: number, h: number): void => {
  realmSizes.set(realm, { w, h });
};

/**
 * Register a function in the handler table outside prop serialization —
 * the proxy DOM's addEventListener uses this. The realm is stamped on the
 * entry so a dispatched event routes its re-render ops to the right queue.
 * `listen`/`unlisten` ops carry the returned id so the main thread can wire
 * and later detach the matching DOM listener.
 */
export const registerHandler = (
  fn: (payload: unknown) => void,
  realm: string,
  instanceId?: number,
): number => {
  const id = nextHandlerId++;
  handlers.set(id, { fn, realm, instanceId });
  return id;
};

export const unregisterHandler = (id: number): void => {
  handlers.delete(id);
};

/**
 * The island→shell channel. Apps call `emit(name, payload)` inside event
 * handlers or commit-phase effects — it just queues an `emit` op, which the
 * main-thread driver routes to the island's `onEvent` callback instead of
 * the DOM. Call it while a task holds the realm (handlers, layout effects);
 * a bare emit from a passive effect has no realm to route to in the
 * many-realms-per-module case and would be dropped.
 */
export const emit = (name: string, payload?: unknown): void => {
  pushOp(activeRealm, { t: 'emit', name, payload });
};

/* ── Prop serialization ─────────────────────────────────────────────────── */

/**
 * Props must cross postMessage, so: `children` is skipped (structure comes
 * from append/remove ops), `key`/`ref` are skipped, functions named `on*`
 * become `{ __evt: id }`, everything else passes through structured clone.
 * Each (instance, propName) pair reuses one handler-id slot, so the id the
 * main thread sees never changes across re-renders — it can attach the DOM
 * listener exactly once while the handler id keeps pointing at the latest
 * closure.
 */
function serializeProps(instance: ElementInstance, props: Record<string, unknown>): WireProps {
  const out: WireProps = {};
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (name === 'children' || name === 'key' || name === 'ref' || name === 'dangerouslySetInnerHTML') {
      continue;
    }
    if (typeof value === 'function') {
      if (name.length > 2 && name.startsWith('on')) {
        let slot = instance.listenerSlots[name];
        if (slot === undefined) {
          slot = nextHandlerId++;
          instance.listenerSlots[name] = slot;
        }
        handlers.set(slot, {
          fn: value as (payload: unknown) => void,
          realm: instance.realm,
          instanceId: instance.id,
        });
        out[name] = { __evt: slot };
      }
      // Non-event functions (render props, callbacks) can't cross the wire — dropped.
      continue;
    }
    out[name] = value; // style objects, numbers, strings, booleans all clone fine
  }
  return out;
}

/* ── Small factories ────────────────────────────────────────────────────── */

function newElement(
  type: string,
  props: Record<string, unknown>,
  ns: string | undefined,
  realm: string,
): ElementInstance {
  const instance: ElementInstance = {
    kind: 'element',
    id: allocId(),
    type,
    ns,
    realm,
    props: {},
    listenerSlots: {},
  };
  instance.props = serializeProps(instance, props);
  instances.set(instance.id, instance);
  return instance;
}

function newText(text: string, realm: string): TextInstance {
  const instance: TextInstance = { kind: 'text', id: allocId(), text, realm };
  instances.set(instance.id, instance);
  return instance;
}

/* ── Event-priority plumbing ────────────────────────────────────────────── */
/*
 * React 19 expresses event priorities as lane numbers: 2 = discrete
 * (click/keydown → SyncLane), 8 = continuous, 32 = default, 0 = none. The
 * reconciler calls setCurrentUpdatePriority around its own flushes
 * (flushSyncFromReconciler sets 2), so honoring the set/get pair and echoing
 * the value back from resolveUpdatePriority is all that's needed.
 */
let currentUpdatePriority = 0;
const DEFAULT_EVENT_PRIORITY = 32;

/* ── React-19 transition context (must be real React objects) ───────────── */

const NotPendingTransition = Object.freeze({ pending: false, data: null, method: null, action: null });
const HostTransitionContext = createContext(NotPendingTransition);

const noop = (): void => {};
const NULL = (): null => null;
const FALSE = (): boolean => false;
const TRUE = (): boolean => true;

/* ── Refs & portals ───────────────────────────────────────────────────────
 *
 * React refs must receive an object the COMPONENT treats as "the element" —
 * for React DOM that's the real DOM node, for us the closest truthful thing
 * is the proxy DOM's facade (it navigates the shadow tree, mutates via ops,
 * and reports `nodeType === 1`). getPublicInstance therefore adopts the
 * host instance into a per-realm proxy document, created lazily so React
 * realms only pay for it when something actually holds a ref.
 *
 * This is what makes react-dom's `createPortal(children, ref.current)` work
 * here: isValidContainer() only checks nodeType, the portal fiber then feeds
 * the facade back as `containerInfo`, and the container-level methods below
 * unwrap `.instance` so portal children land inside the real target node —
 * that is the entire recharts <Tooltip>/<Legend> path.
 */
const publicInstanceFor = (instance: HostInstance): ProxyNode | HostInstance =>
  realmDocFor(instance.realm).adopt(instance);

/**
 * Portal `containerInfo` is the public instance (a ProxyElement) the caller
 * passed to createPortal; the ROOT_CONTAINER sentinel and raw instances keep
 * their own `id`. Anything unrecognizable falls back to the island root.
 */
const containerParentId = (container: unknown): number => {
  const inst = (container as { instance?: { id?: unknown } } | null)?.instance;
  if (inst && typeof inst.id === 'number') return inst.id;
  const id = (container as { id?: unknown } | null)?.id;
  return typeof id === 'number' ? id : 0;
};

/**
 * The realm a create should bind to — read off the root container for
 * ordinary renders, off the portal container's wrapped instance for portal
 * subtrees (a ProxyElement, whose `.realm` field doesn't exist but whose
 * `.instance.realm` does), finally falling back to ambient realm state.
 */
const containerRealm = (container: unknown): string => {
  const c = container as (RootContainer & { instance?: { realm?: string } }) | null;
  return c?.realm ?? c?.instance?.realm ?? (activeRealm !== '' ? activeRealm : lastRealm);
};

/* Host context = DOM namespace tracking, same role it plays in React DOM:
 * `getChildHostContext` flips the namespace when the element type requires
 * it, and `createInstance` stamps the result on the instance so the `create`
 * op can tell the driver to createElementNS. Recharts-style SVG trees need
 * this — without it every <svg>/<path> would arrive as an HTMLUnknownElement. */
interface HostContext {
  ns?: string;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
const MATH_NS = 'http://www.w3.org/1998/Math/MathML';
const HTML_CTX: HostContext = Object.freeze({});
const SVG_CTX: HostContext = Object.freeze({ ns: SVG_NS });
const MATH_CTX: HostContext = Object.freeze({ ns: MATH_NS });

/** The namespace context a host element gives its children — and the
 *  namespace the element itself belongs to (getChildNamespace semantics:
 *  <svg> in HTML is SVG, foreignObject/desc/title flip back to HTML). */
const childHostContextFor = (parent: HostContext, type: string): HostContext => {
  if (type === 'svg') return SVG_CTX;
  if (type === 'math') return MATH_CTX;
  if (type === 'foreignObject' || type === 'desc' || type === 'title') return HTML_CTX;
  return parent;
};

/* ── The host config ────────────────────────────────────────────────────── */

export const hostConfig = {
  // Identity / capabilities
  rendererVersion: '0.34.0',
  rendererPackageName: '@jwhenry123/mesh-worker-dom',
  extraDevToolsConfig: null,
  isPrimaryRenderer: true,
  warnsIfNotActing: false,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsResources: false,
  supportsSingletons: false,
  supportsMicrotasks: false,
  supportsTestSelectors: false,

  getPublicInstance: (instance: HostInstance): unknown => publicInstanceFor(instance),
  // Host contexts must be non-null objects (the reconciler pushes them on a
  // context stack and warns "Expected host context to exist" on null). This
  // renderer carries no per-subtree context — echo a single frozen sentinel.
  // Host contexts must be non-null objects (the reconciler warns on null).
  // Ours carries only the element namespace: <svg>/<math> enter their
  // namespaces; foreignObject/desc/title are HTML-integration points that
  // flip children back to HTML; everything else inherits the parent's.
  // For portals, this becomes the context the portal subtree renders under —
  // derived from the container's own namespace so children of an SVG portal
  // target (recharts zIndex <g> layers) stay in the SVG namespace.
  getRootHostContext: (container: unknown): HostContext => {
    const ns = (container as { instance?: { ns?: string } } | null)?.instance?.ns;
    if (ns === SVG_NS) return SVG_CTX;
    if (ns === MATH_NS) return MATH_CTX;
    return HTML_CTX;
  },
  getChildHostContext: (parent: HostContext, type: string): HostContext =>
    childHostContextFor(parent, type),
  prepareForCommit: NULL,
  // The doorbell: every commit bumps opsVersion once — the main thread's
  // observe() wakes (Atomics.waitAsync) and flushes the op queue, so commits
  // made outside task calls (effects, timers, async setState) arrive as a
  // push instead of waiting on a poll. Task-returned ops bump too; the
  // follow-up flush just finds an empty queue.
  resetAfterCommit: bumpOpsVersion,

  // Creation — emit ops
  createInstance: (
    type: string,
    props: Record<string, unknown>,
    rootContainer: unknown,
    hostContext: unknown,
    _internalHandle: unknown,
  ): ElementInstance => {
    // The element's own namespace = the child context its TYPE produces
    // under the parent's context — the same computation React DOM runs
    // (getChildNamespace): <svg> in HTML is itself SVG, <foreignObject> in
    // SVG is itself HTML. Realm comes from the container (see RootContainer).
    const ctx = childHostContextFor(hostContext as HostContext, type);
    const instance = newElement(type, props, ctx.ns, containerRealm(rootContainer));
    pushOp(instance.realm, {
      t: 'create',
      id: instance.id,
      type,
      props: instance.props,
      ns: instance.ns,
    });
    return instance;
  },
  createTextInstance: (
    text: string,
    rootContainer: unknown,
    _hostContext: unknown,
    _internalHandle: unknown,
  ): TextInstance => {
    const instance = newText(text, containerRealm(rootContainer));
    pushOp(instance.realm, { t: 'text', id: instance.id, text });
    return instance;
  },
  finalizeInitialChildren: FALSE,
  // Always false: string/number children become real text instances, so the
  // tree arrives as linear ops and `utext` handles every text update. (The
  // `true` path would expect commitUpdate to set textContent from
  // props.children — which we deliberately never serialize.)
  shouldSetTextContent: FALSE,

  // Tree wiring — emit ops
  appendInitialChild: (parent: HostInstance, child: HostInstance): void => {
    pushOp(parent.realm, { t: 'append', parent: parent.id, child: child.id });
  },
  appendChild: (parent: HostInstance, child: HostInstance): void => {
    pushOp(parent.realm, { t: 'append', parent: parent.id, child: child.id });
  },
  appendChildToContainer: (container: unknown, child: HostInstance): void => {
    pushOp(child.realm, { t: 'append', parent: containerParentId(container), child: child.id });
  },
  insertBefore: (parent: HostInstance, child: HostInstance, before: HostInstance): void => {
    pushOp(parent.realm, { t: 'append', parent: parent.id, child: child.id, before: before.id });
  },
  insertInContainerBefore: (container: unknown, child: HostInstance, before: HostInstance): void => {
    pushOp(child.realm, {
      t: 'append',
      parent: containerParentId(container),
      child: child.id,
      before: before.id,
    });
  },
  removeChild: (_parent: HostInstance, child: HostInstance): void => {
    pushOp(child.realm, { t: 'remove', child: child.id });
  },
  removeChildFromContainer: (_container: unknown, child: HostInstance): void => {
    pushOp(child.realm, { t: 'remove', child: child.id });
  },
  // No instance argument — routed by the task's active realm (only reached
  // inside mount/remount's syncCommit).
  clearContainer: (): void => {
    pushOp(activeRealm, { t: 'clear' });
  },

  // Updates — emit ops
  commitUpdate: (
    instance: ElementInstance,
    _type: string,
    _oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
    _internalHandle: unknown,
  ): void => {
    instance.props = serializeProps(instance, newProps);
    pushOp(instance.realm, { t: 'update', id: instance.id, props: instance.props });
  },
  commitTextUpdate: (instance: TextInstance, _oldText: string, newText: string): void => {
    instance.text = newText;
    pushOp(instance.realm, { t: 'utext', id: instance.id, text: newText });
  },
  commitMount: noop,
  // Unreachable while shouldSetTextContent is always false; still emit the
  // spec'd op for completeness.
  resetTextContent: (instance: ElementInstance): void => {
    instance.props = {};
    pushOp(instance.realm, { t: 'update', id: instance.id, props: {} });
  },

  // Suspense visibility — `hidden` is a global HTML attribute the main
  // thread applies like any other prop.
  hideInstance: (instance: ElementInstance): void => {
    pushOp(instance.realm, { t: 'update', id: instance.id, props: { ...instance.props, hidden: true } });
  },
  unhideInstance: (instance: ElementInstance): void => {
    pushOp(instance.realm, { t: 'update', id: instance.id, props: { ...instance.props } });
  },
  hideTextInstance: (instance: TextInstance): void => {
    pushOp(instance.realm, { t: 'utext', id: instance.id, text: '' });
  },
  unhideTextInstance: (instance: TextInstance, text: string): void => {
    pushOp(instance.realm, { t: 'utext', id: instance.id, text });
  },

  // GC hook — drop the record and its handler slots.
  detachDeletedInstance: (instance: HostInstance): void => {
    instances.delete(instance.id);
    if (instance.kind === 'element') {
      for (const hid of Object.values(instance.listenerSlots)) handlers.delete(hid);
    }
  },

  // Scheduler
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  // supportsMicrotasks is false, so the reconciler schedules root work via
  // the `scheduler` package (MessageChannel in a worker). This export is
  // still destructured — provide a real one for completeness.
  scheduleMicrotask: (fn: () => void): void => queueMicrotask(fn),

  // Event priorities (see note above — values are lane numbers).
  setCurrentUpdatePriority: (p: number): void => {
    currentUpdatePriority = p;
  },
  getCurrentUpdatePriority: (): number => currentUpdatePriority,
  resolveUpdatePriority: (): number =>
    currentUpdatePriority !== 0 ? currentUpdatePriority : DEFAULT_EVENT_PRIORITY,
  resolveEventType: NULL,
  resolveEventTimeStamp: (): number => -1.1,
  trackSchedulerEvent: noop,
  shouldAttemptEagerTransition: FALSE,

  // Events/portals/scopes — no DOM event system exists worker-side.
  getInstanceFromNode: NULL,
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  preparePortalMount: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope: NULL,

  // React 19 "suspend on commit" — never suspend.
  requestPostPaintCallback: noop,
  maySuspendCommit: FALSE,
  maySuspendCommitOnUpdate: FALSE,
  maySuspendCommitInSyncRender: FALSE,
  preloadInstance: TRUE,
  startSuspendingCommit: noop,
  suspendInstance: noop,
  suspendOnActiveViewTransition: noop,
  waitForCommitToBeReady: NULL,
  getSuspendedCommitReason: () => 0,

  // Transitions / forms / console
  NotPendingTransition,
  HostTransitionContext,
  resetFormInstance: noop,
  bindToConsole: (methodName: string, args: unknown[]) =>
    (console as unknown as Record<string, (...a: unknown[]) => void>)[methodName]?.bind(console, ...args) ??
    noop,

  // Persistence (supportsPersistence: false — destructured, never called)
  createContainerChildSet: () => [],
  appendChildToContainerChildSet: noop,
  finalizeContainerChildren: noop,
  replaceContainerChildren: noop,
  cloneInstance: NULL,
  cloneMutableInstance: (instance: HostInstance) => instance,
  cloneMutableTextInstance: (instance: HostInstance) => instance,
  cloneHiddenInstance: (instance: HostInstance) => instance,
  cloneHiddenTextInstance: (instance: HostInstance) => instance,

  // Fragment instances (only used for `<Fragment ref={…}>` — unimplemented)
  createFragmentInstance: () => ({}),
  updateFragmentInstanceFiber: noop,
  commitNewChildToFragmentInstance: noop,
  deleteChildFromFragmentInstance: noop,

  // View transitions (React 19) — all stubs
  createViewTransitionInstance: (name: string) => ({ name, autoName: null }),
  applyViewTransitionName: noop,
  restoreViewTransitionName: noop,
  cancelViewTransitionName: noop,
  cancelRootViewTransitionName: noop,
  restoreRootViewTransitionName: noop,
  cloneRootViewTransitionContainer: noop,
  removeRootViewTransitionClone: noop,
  measureInstance: NULL,
  measureClonedInstance: NULL,
  wasInstanceInViewport: FALSE,
  hasInstanceChanged: FALSE,
  hasInstanceAffectedParent: FALSE,
  startViewTransition: NULL,
  startGestureTransition: NULL,
  stopViewTransition: noop,
  addViewTransitionFinishedListener: noop,
  getCurrentGestureOffset: () => 0,

  // Hydration (supportsHydration: false — destructured, never called)
  isSuspenseInstancePending: FALSE,
  isSuspenseInstanceFallback: FALSE,
  getSuspenseInstanceFallbackErrorDetails: () => ({}),
  registerSuspenseInstanceRetry: noop,
  getNextHydratableSibling: NULL,
  getNextHydratableSiblingAfterSingleton: NULL,
  getFirstHydratableChild: NULL,
  getFirstHydratableChildWithinContainer: NULL,
  getFirstHydratableChildWithinActivityInstance: NULL,
  getFirstHydratableChildWithinSingleton: NULL,
  getFirstHydratableChildWithinSuspenseInstance: NULL,
  canHydrateInstance: NULL,
  canHydrateTextInstance: NULL,
  canHydrateActivityInstance: NULL,
  canHydrateSuspenseInstance: NULL,
  canHydrateFormStateMarker: NULL,
  isFormStateMarkerMatching: FALSE,
  hydrateInstance: noop,
  hydrateTextInstance: noop,
  hydrateActivityInstance: noop,
  hydrateSuspenseInstance: noop,
  getNextHydratableInstanceAfterActivityInstance: NULL,
  getNextHydratableInstanceAfterSuspenseInstance: NULL,
  commitHydratedInstance: noop,
  commitHydratedContainer: noop,
  commitHydratedSuspenseInstance: noop,
  finalizeHydratedChildren: FALSE,
  flushHydrationEvents: noop,
  clearActivityBoundary: FALSE,
  clearSuspenseBoundary: FALSE,
  clearActivityBoundaryFromContainer: FALSE,
  clearSuspenseBoundaryFromContainer: FALSE,
  hideDehydratedBoundary: noop,
  unhideDehydratedBoundary: noop,
  shouldDeleteUnhydratedTailInstances: FALSE,
  diffHydratedPropsForDevWarnings: NULL,
  diffHydratedTextForDevWarnings: NULL,
  describeHydratableInstanceForDevWarnings: NULL,
  validateHydratableInstance: TRUE,
  validateHydratableTextInstance: TRUE,

  // Host resources (stylesheets/scripts — supportsResources: false)
  isHostHoistableType: FALSE,
  getHoistableRoot: NULL,
  getResource: NULL,
  acquireResource: noop,
  releaseResource: noop,
  hydrateHoistable: noop,
  mountHoistable: noop,
  unmountHoistable: noop,
  createHoistableInstance: NULL,
  prepareToCommitHoistables: noop,
  mayResourceSuspendCommit: FALSE,
  preloadResource: TRUE,
  suspendResource: noop,

  // Singletons (supportsSingletons: false)
  resolveSingletonInstance: NULL,
  acquireSingletonInstance: noop,
  releaseSingletonInstance: noop,
  isHostSingletonType: FALSE,
  isSingletonScope: FALSE,

  // Test selectors (supportsTestSelectors: false)
  findFiberRoot: NULL,
  getBoundingRect: NULL,
  getTextContent: NULL,
  isHiddenSubtree: FALSE,
  matchAccessibilityRole: FALSE,
  setFocusIfFocusable: FALSE,
  setupIntersectionObserver: noop,
};
