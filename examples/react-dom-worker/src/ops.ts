/**
 * The whole protocol between the two threads.
 *
 * The worker runs a real React reconciler whose "host environment" is a set
 * of records in a Map — every render-phase and mutation-phase host-config
 * call appends one of these ops to a queue. Task methods (`mount`,
 * `updateProps`, `dispatch`, `flush`) return the flushed batch, and the main
 * thread's only job is to replay them against the DOM. Ops ride postMessage —
 * no shared memory is involved.
 *
 * ISLANDS: every island owns an independent op stream — instance ids are only
 * unique within one worker, so each island's driver keeps its own node map
 * (see src/island.ts). `emit` is the one op that is NOT a DOM mutation: it is
 * the island→shell event channel — the driver hands `{name, payload}` to the
 * shell-registered `onEvent` callback instead of touching the DOM.
 */
export type Op =
  /** createElement-equivalent — `props` is already wire-serialized. */
  | { t: 'create'; id: number; type: string; props: WireProps }
  /** createTextNode-equivalent. */
  | { t: 'text'; id: number; text: string }
  /** `parent.insertBefore(child, before ?? null)` — parent 0 is the root container. */
  | { t: 'append'; parent: number; child: number; before?: number }
  /** Detach `child` from wherever it is mounted. */
  | { t: 'remove'; child: number }
  /** Re-serialized full prop set for `id` (main diffs against its last seen set). */
  | { t: 'update'; id: number; props: WireProps }
  /** New text content for a text instance. Also how the proxy DOM writes
   *  `element.textContent` — the driver assigns `node.textContent`, which
   *  replaces the element's children with a single text node. */
  | { t: 'utext'; id: number; text: string }
  /** Clear the root container (React's clearContainer, or an imperative
   *  realm's rebuild). */
  | { t: 'clear' }
  /**
   * Set/remove a single attribute — emitted by the worker-side proxy DOM
   * (`setAttribute`, `id`/`className` setters, `classList`, `dataset`).
   * `value: null` removes the attribute.
   */
  | { t: 'attr'; id: number; name: string; value: string | null }
  /**
   * Merge inline-style changes — the proxy DOM's `style` proxy re-sends only
   * the changed keys; `''` clears a key (deleteProperty).
   */
  | { t: 'style'; id: number; props: Record<string, string> }
  /**
   * Attach a DOM listener for a proxy-DOM `addEventListener` — `handler` is
   * a worker handler-table id (same currency as `__evt` refs); the driver
   * wires it to `client.dispatch(handler, payload)`.
   */
  | { t: 'listen'; id: number; type: string; handler: number }
  /** Detach the listener a `listen` op attached (type + handler identify it). */
  | { t: 'unlisten'; id: number; type: string; handler: number }
  /**
   * Island → shell event — worker code calls `emit(name, payload)` inside a
   * handler (or a commit-phase effect); the driver invokes the island's
   * `onEvent(name, payload)` instead of mutating the DOM. Payloads must be
   * structured-cloneable — same rule as props.
   */
  | { t: 'emit'; name: string; payload?: unknown };

/**
 * Wire-serialized props. Functions named `on*` (onClick, onInput, …) cross as
 * `{ __evt: handlerId }`; the main thread turns that into a DOM listener that
 * dispatches back into the worker. `children` never crosses — tree structure
 * is expressed entirely by append/remove ops.
 *
 * One prop is NOT a normal attribute: `data-mesh-slot` marks a transclusion
 * slot — a leaf element whose box is worker-owned but whose contents the
 * shell mounts main-thread DOM into (the island's `slots` registry). The
 * driver routes it to the slot machinery instead of treating it like any
 * other data attribute.
 */
export type WireProps = Record<string, unknown>;

/** Marker for a prop that was a function — a handle into the worker's handler table. */
export interface EventRef {
  __evt: number;
}

export const isEventRef = (v: unknown): v is EventRef =>
  typeof v === 'object' && v !== null && '__evt' in v;

/**
 * What the main thread sends back when a DOM event fires. Deliberately NOT a
 * SyntheticEvent — just a best-effort handful of fields read off the DOM
 * event and its target. Mouse fields are `undefined` for non-mouse events;
 * `targetId` is only set when the event target is an op-created node (shell-
 * owned slot content has no instance id).
 */
export interface EventPayload {
  type: string;
  value?: string;
  checked?: boolean;
  key?: string;
  clientX?: number;
  clientY?: number;
  button?: number;
  /** `target.scrollTop` when the target is an element. */
  scrollTop?: number;
  /** The worker instance id of `event.target`, when it maps to one. */
  targetId?: number;
}
