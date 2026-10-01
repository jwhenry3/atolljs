/**
 * Instance-scoped state shared by every renderer backend running inside a worker.
 *
 * - Per-instance op queues: each island/app owns a queue of {@link Op}s that the
 *   main-thread driver replays as real DOM mutations.
 * - A shared id counter for element/text instances, used by both the React
 *   reconciler and the proxy DOM.
 * - Handler registry for event listeners.
 * - Doorbell contract used to bump the ops-version after a commit.
 * - Pushed container-size geometry.
 *
 * This module is renderer-agnostic: it contains no react-reconciler imports.
 * The React-specific host config lives in `hostConfig.ts`.
 */

import { renderMemory } from '../memory';
import { enterProxyFrame, exitProxyFrame, proxyMetrics } from '../metrics';
import type { IslandContract } from '../contract';
import type { Op, WireProps } from '../ops';

/**
 * Run `body` as one instrumented proxy-engine frame while metrics are
 * enabled — a direct call otherwise (one predictable branch per chokepoint).
 * `enter`/`exit` share a depth guard so nested frames (a dom/* method
 * calling pushOp, serializeProps inside newElement) never double-count.
 */
const timed = <T>(body: () => T): T => {
  if (!proxyMetrics.enabled) return body();
  const t0 = enterProxyFrame();
  try {
    return body();
  } finally {
    exitProxyFrame(t0);
  }
};

/* ── Host instances ─────────────────────────────────────────────────────── */

export interface ElementInstance {
  kind: 'element';
  id: number;
  type: string;
  /** Which mounted app this node belongs to — routes its ops. */
  instance: string;
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
  instance: string;
}

export type HostInstance = ElementInstance | TextInstance;

/** The root container is a sentinel — op `parent: 0` means "the root".
 *  definePolyWorker stamps `instance` on the container it hands
 *  createContainer, so createInstance can bind every element to the instance
 *  that rendered it — deterministic even when a commit runs outside a instance
 *  task (passive-effect renders, scheduler flushes), where activeInstance is
 *  ''. Instance-bound ops then always reach their island's queue. */
export interface RootContainer {
  id: 0;
  instance?: string;
}
export const ROOT_CONTAINER = Object.freeze({ id: 0 }) as RootContainer;

/* ── Per-instance op queues + instance/handler tables ──────────────────────── */

/** instance (app name) → queued ops. Each island flushes only its own queue. */
const opsByInstance = new Map<string, Op[]>();
/** The instance a task is currently executing under — see setActiveInstance. */
let activeInstance = '';
/**
 * instance id → host record. Exported so the proxy DOM (worker/proxyDom.ts)
 * shares the SAME instance space as the reconciler: a proxy-created element
 * can nest inside a React-rendered parent and vice versa, because ops are
 * id-addressed and ids come from one counter.
 */
export const instances = new Map<number, HostInstance>();
interface HandlerEntry {
  fn: (payload: unknown) => void;
  instance: string;
  /** The element this handler was attached to — the event's currentTarget. */
  instanceId?: number;
}
/** handler id → prop function + owning instance. Lives worker-side; never serialized. */
const handlers = new Map<number, HandlerEntry>();
let nextId = 1;
let nextHandlerId = 1;

/**
 * instance key → the `withContract`-attached contract (undefined for
 * unstamped apps — most mounts). `emit` validates declared event payloads
 * against it; defineWorkers registers it at instance create and clears it
 * at unmount.
 */
const instanceContracts = new Map<string, IslandContract>();
export const setInstanceContract = (
  instance: string,
  contract: IslandContract | undefined,
): void => {
  if (contract === undefined) instanceContracts.delete(instance);
  else instanceContracts.set(instance, contract);
};

/** Allocate an instance id — the shared counter React and the proxy DOM both draw from. */
export const allocId = (): number => nextId++;

/**
 * Marks which instance the currently-running task belongs to; returns the
 * previous value for restore. Structural ops don't need it — they route by
 * their instance's instance — but instance-less ops (`clear`, `emit`) and
 * handler dispatch do. Worker tasks run synchronously, so a single pointer
 * is safe even when several mounts coexist in one module.
 */
let lastInstance = '';
export const setActiveInstance = (instance: string): string => {
  const prev = activeInstance;
  activeInstance = instance;
  if (instance !== '') lastInstance = instance;
  return prev;
};

/** The instance the current task is running under — '' outside a instance task. */
export const getActiveInstance = (): string => activeInstance;

/**
 * The most recent instance a task ran under — used by the instance dispatcher to
 * route deferred library work (timers, promise continuations) to the right
 * document when several mounts share one module (in-process tests).
 */
export const getLastActiveInstance = (): string => lastInstance;

/**
 * The most recent instance an op was pushed for — stamped in `pushOp`, so
 * every proxy-DOM mutation records it. This is the last rung of the
 * ambient-resolution chain (active → lastActive → lastTouched): a renderer
 * whose scheduler flushes outside any task still lands on the instance whose
 * tree it just mutated.
 */
let touchedInstance = '';
export const getLastTouchedInstance = (): string => touchedInstance;

/**
 * Marks `instance` as the ambient instance for out-of-task readers (timers,
 * continuations, shim consumers outside instance work). Called by
 * installDomShim so its document becomes the ambient document.
 */
export const markInstanceActive = (instance: string): void => {
  if (instance) lastInstance = instance;
};

/**
 * Run `fn` while `instance` is the active instance — the imperative-code twin of
 * the reconciler's syncCommit wrapper. Imperative DOM writes (`emit`, the
 * proxy DOM's `emit` calls, `clear`) only route correctly while a instance
 * task holds the active instance: mount, updateProps, and dispatch all wrap
 * their work in this, and imperative apps should do the same for any
 * worker-initiated work (timers, promise continuations).
 */
export const runInInstance = <T>(instance: string, fn: () => T): T => {
  const prev = setActiveInstance(instance);
  try {
    return fn();
  } finally {
    setActiveInstance(prev);
  }
};

/** Queue an op onto a instance's queue — instance-bound ops pass their
 *  instance's instance, instance-less ops (`clear`, `emit`) the active one. */
export const pushOp = (instance: string, op: Op): void =>
  timed(() => {
    if (instance !== '') touchedInstance = instance;
    let queue = opsByInstance.get(instance);
    if (!queue) opsByInstance.set(instance, (queue = []));
    queue.push(op);
    proxyMetrics.opsPushed++;
  });

/** The minimum surface `bumpOpsVersion` needs off the doorbell contract. */
interface DoorbellContract {
  readonly bound: boolean;
  connector(path: string): { read(): unknown; write(v: unknown): void };
}

/**
 * The contract `bumpOpsVersion` writes to — `renderMemory` by default, or
 * whatever doorbell-shaped contract `definePolyWorker({ sharedMemory })`
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

/** Drain one instance's queued ops — called by the worker's task methods. */
export const takeOps = (instance: string): Op[] =>
  timed(() => {
    const queue = opsByInstance.get(instance);
    if (!queue || queue.length === 0) return [];
    opsByInstance.set(instance, []);
    return queue;
  });

/**
 * Structural memory snapshot of the proxy layer — how much shadow state the
 * engine retains for live + previously-allocated nodes, handlers, and ops
 * still queued. `instances` is not pruned on removeChild (event dispatch may
 * still resolve detached target ids), so liveNodes is nodes-ever-allocated.
 */
export const proxyInstanceStats = (): {
  liveNodes: number;
  handlers: number;
  queuedOps: number;
} => ({
  liveNodes: instances.size,
  handlers: handlers.size,
  queuedOps: [...opsByInstance.values()].reduce((a, q) => a + q.length, 0),
});

export const getHandler = (id: number): HandlerEntry | undefined => handlers.get(id);

/* ── Pushed container size (setSize channel) ────────────────────────────── */

/**
 * instance key → the island container's last measured {w,h}, pushed by the
 * driver's `setSize` task. This is the ONLY geometry channel: the main
 * thread can only measure the island's root box, so the proxy DOM serves
 * this value to `doc.body`/`documentElement` and to elements explicitly
 * marked `doc.markContainer(el)` — every other element keeps the honest 0.
 * Module-level (not per-document) so it survives imperative rebuilds that
 * swap in a fresh proxy document.
 */
const instanceSizes = new Map<string, { w: number; h: number }>();

/** The instance's last pushed container size, or undefined if none arrived. */
export const getInstanceSize = (instance: string): { w: number; h: number } | undefined =>
  instanceSizes.get(instance);

/** Store the container size a `setSize` task pushed. */
export const setInstanceSize = (instance: string, w: number, h: number): void => {
  instanceSizes.set(instance, { w, h });
};

/**
 * Register a function in the handler table outside prop serialization —
 * the proxy DOM's addEventListener uses this. The instance is stamped on the
 * entry so a dispatched event routes its re-render ops to the right queue.
 * `listen`/`unlisten` ops carry the returned id so the main thread can wire
 * and later detach the matching DOM listener.
 */
export const registerHandler = (
  fn: (payload: unknown) => void,
  instance: string,
  instanceId?: number,
): number =>
  timed(() => {
    const id = nextHandlerId++;
    handlers.set(id, { fn, instance, instanceId });
    return id;
  });

export const unregisterHandler = (id: number): void => {
  timed(() => {
    handlers.delete(id);
  });
};

/**
 * The island→shell channel. Apps call `emit(name, payload)` inside event
 * handlers or commit-phase effects — it just queues an `emit` op, which the
 * main-thread driver routes to the island's `onEvent` callback instead of
 * the DOM. Call it while a task holds the instance (handlers, layout effects);
 * a bare emit from a passive effect has no instance to route to in the
 * many-mounts-per-module case and would be dropped.
 */
export const emit = (name: string, payload?: unknown): void => {
  timed(() => {
    // Contract enforcement: a declared event's payload parses before it
    // crosses — undeclared names pass through (the contract describes the
    // wire; it doesn't fence forward-compatible additions).
    const schema = instanceContracts.get(activeInstance)?.events?.[name];
    if (schema !== undefined) {
      try {
        payload = schema.parse(payload);
      } catch (err) {
        throw new Error(
          `emit("${name}") rejected by the island contract for "${activeInstance}": ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
    pushOp(activeInstance, { t: 'emit', name, payload });
  });
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
export function serializeProps(instance: ElementInstance, props: Record<string, unknown>): WireProps {
  return timed(() => {
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
            instance: instance.instance,
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
  });
}

/* ── Small factories ────────────────────────────────────────────────────── */

export function newElement(
  type: string,
  props: Record<string, unknown>,
  ns: string | undefined,
  instance: string,
): ElementInstance {
  return timed(() => {
    const record: ElementInstance = {
      kind: 'element',
      id: allocId(),
      type,
      ns,
      instance,
      props: {},
      listenerSlots: {},
    };
    record.props = serializeProps(record, props);
    instances.set(record.id, record);
    return record;
  });
}

export function newText(text: string, instance: string): TextInstance {
  return timed(() => {
    const record: TextInstance = { kind: 'text', id: allocId(), text, instance };
    instances.set(record.id, record);
    return record;
  });
}
