/**
 * The host config that lets react-reconciler run with no DOM at all.
 *
 * "Host instances" are plain records in a Map — `{ kind:'element', id, type }`
 * or `{ kind:'text', id, text }`. Every render-phase and mutation-phase hook
 * the reconciler calls appends a serialized {@link Op} to a queue; the task
 * methods in render.worker.ts flush that queue back to the main thread,
 * which replays the ops as real DOM mutations. The reconciler itself never
 * touches `document`, `window`, or `self.postMessage` — that is the point of
 * the demo: React's render logic is DOM-free.
 *
 * react-reconciler@0.34 reads ~150 fields off the config object. Most are
 * stubs for features this renderer doesn't implement (hydration,
 * persistence, resources, singletons, view transitions, test selectors,
 * scope/hydratable APIs) — they exist so nothing throws when the reconciler
 * destructures them; they are never invoked behind the `supports*` flags.
 */

import { createContext } from 'react';
import { renderMemory } from '../memory';
import type { Op, WireProps } from '../ops';

/* ── Host instances ─────────────────────────────────────────────────────── */

export interface ElementInstance {
  kind: 'element';
  id: number;
  type: string;
  /** Last serialized prop set — needed so hide/unhide can resend it. */
  props: WireProps;
  /** propName → stable handler id (keeps DOM listeners stable across updates). */
  listenerSlots: Record<string, number>;
}

export interface TextInstance {
  kind: 'text';
  id: number;
  text: string;
}

export type HostInstance = ElementInstance | TextInstance;

/** The root container is a sentinel — op `parent: 0` means "the root". */
export const ROOT_CONTAINER = Object.freeze({ id: 0 });

/* ── Op queue + instance/handler tables ─────────────────────────────────── */

const ops: Op[] = [];
const instances = new Map<number, HostInstance>();
/** handler id → the actual prop function. Lives worker-side; never serialized. */
const handlers = new Map<number, (payload: unknown) => void>();
let nextId = 1;
let nextHandlerId = 1;

/** Drain the queued ops — called by the worker's task methods. */
export const takeOps = (): Op[] => ops.splice(0, ops.length);

export const getHandler = (id: number): ((payload: unknown) => void) | undefined =>
  handlers.get(id);

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
        handlers.set(slot, value as (payload: unknown) => void);
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

function newElement(type: string, props: Record<string, unknown>): ElementInstance {
  const instance: ElementInstance = { kind: 'element', id: nextId++, type, props: {}, listenerSlots: {} };
  instance.props = serializeProps(instance, props);
  instances.set(instance.id, instance);
  return instance;
}

function newText(text: string): TextInstance {
  const instance: TextInstance = { kind: 'text', id: nextId++, text };
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
const DEFAULT_HOST_CONTEXT = Object.freeze({});

/* ── The host config ────────────────────────────────────────────────────── */

export const hostConfig = {
  // Identity / capabilities
  rendererVersion: '0.34.0',
  rendererPackageName: 'react-dom-worker',
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

  getPublicInstance: (instance: HostInstance): HostInstance => instance,
  // Host contexts must be non-null objects (the reconciler pushes them on a
  // context stack and warns "Expected host context to exist" on null). This
  // renderer carries no per-subtree context — echo a single frozen sentinel.
  getRootHostContext: () => DEFAULT_HOST_CONTEXT,
  getChildHostContext: (parent: unknown) => parent,
  prepareForCommit: NULL,
  // The doorbell: every commit bumps opsVersion once — the main thread's
  // observe() wakes (Atomics.waitAsync) and flushes the op queue, so commits
  // made outside task calls (effects, timers, async setState) arrive as a
  // push instead of waiting on a poll. Task-returned ops bump too; the
  // follow-up flush just finds an empty queue.
  resetAfterCommit: () => {
    const bell = renderMemory.connector('opsVersion');
    bell.write((bell.read() ?? 0) + 1);
  },

  // Creation — emit ops
  createInstance: (
    type: string,
    props: Record<string, unknown>,
    _rootContainer: unknown,
    _hostContext: unknown,
    _internalHandle: unknown,
  ): ElementInstance => {
    const instance = newElement(type, props);
    ops.push({ t: 'create', id: instance.id, type, props: instance.props });
    return instance;
  },
  createTextInstance: (
    text: string,
    _rootContainer: unknown,
    _hostContext: unknown,
    _internalHandle: unknown,
  ): TextInstance => {
    const instance = newText(text);
    ops.push({ t: 'text', id: instance.id, text });
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
    ops.push({ t: 'append', parent: parent.id, child: child.id });
  },
  appendChild: (parent: HostInstance, child: HostInstance): void => {
    ops.push({ t: 'append', parent: parent.id, child: child.id });
  },
  appendChildToContainer: (_container: unknown, child: HostInstance): void => {
    ops.push({ t: 'append', parent: 0, child: child.id });
  },
  insertBefore: (parent: HostInstance, child: HostInstance, before: HostInstance): void => {
    ops.push({ t: 'append', parent: parent.id, child: child.id, before: before.id });
  },
  insertInContainerBefore: (_container: unknown, child: HostInstance, before: HostInstance): void => {
    ops.push({ t: 'append', parent: 0, child: child.id, before: before.id });
  },
  removeChild: (_parent: HostInstance, child: HostInstance): void => {
    ops.push({ t: 'remove', child: child.id });
  },
  removeChildFromContainer: (_container: unknown, child: HostInstance): void => {
    ops.push({ t: 'remove', child: child.id });
  },
  clearContainer: (): void => {
    ops.push({ t: 'clear' });
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
    ops.push({ t: 'update', id: instance.id, props: instance.props });
  },
  commitTextUpdate: (instance: TextInstance, _oldText: string, newText: string): void => {
    instance.text = newText;
    ops.push({ t: 'utext', id: instance.id, text: newText });
  },
  commitMount: noop,
  // Unreachable while shouldSetTextContent is always false; still emit the
  // spec'd op for completeness.
  resetTextContent: (instance: ElementInstance): void => {
    instance.props = {};
    ops.push({ t: 'update', id: instance.id, props: {} });
  },

  // Suspense visibility — `hidden` is a global HTML attribute the main
  // thread applies like any other prop.
  hideInstance: (instance: ElementInstance): void => {
    ops.push({ t: 'update', id: instance.id, props: { ...instance.props, hidden: true } });
  },
  unhideInstance: (instance: ElementInstance): void => {
    ops.push({ t: 'update', id: instance.id, props: { ...instance.props } });
  },
  hideTextInstance: (instance: TextInstance): void => {
    ops.push({ t: 'utext', id: instance.id, text: '' });
  },
  unhideTextInstance: (instance: TextInstance, text: string): void => {
    ops.push({ t: 'utext', id: instance.id, text });
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
  getFirstHydratableChildWithinSuspenseInstance: NULL,
  getFirstHydratableChildWithinSingleton: NULL,
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
  commitHydratedActivityInstance: noop,
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
