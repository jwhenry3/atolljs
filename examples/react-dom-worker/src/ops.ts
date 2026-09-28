/**
 * The whole protocol between the two threads.
 *
 * The worker runs a real React reconciler whose "host environment" is a set
 * of records in a Map — every render-phase and mutation-phase host-config
 * call appends one of these ops to a queue. Task methods (`mount`,
 * `dispatch`, `flush`) return the flushed batch, and the main thread's only
 * job is to replay them against the DOM. Ops ride postMessage — no shared
 * memory is involved.
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
  /** New text content for a text instance. */
  | { t: 'utext'; id: number; text: string }
  /** Clear the root container (React's clearContainer). */
  | { t: 'clear' };

/**
 * Wire-serialized props. Functions named `on*` (onClick, onInput, …) cross as
 * `{ __evt: handlerId }`; the main thread turns that into a DOM listener that
 * dispatches back into the worker. `children` never crosses — tree structure
 * is expressed entirely by append/remove ops.
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
 * SyntheticEvent — just the handful of fields the demo needs.
 */
export interface EventPayload {
  type: string;
  value?: string;
  checked?: boolean;
  key?: string;
}
