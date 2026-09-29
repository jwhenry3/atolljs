/**
 * Callback-prop marshalling — props cross postMessage as plain data, so a
 * function prop can't travel as-is. `callbackProp(fn)` marks a shell-side
 * function; mount/updateProps marshal markers into `{ __cb: id }` handles
 * (registered in the island's callback table); the worker deserializes
 * them into callables that push an `emit` op back on a reserved name, and
 * the driver dispatches those emits to the table instead of `onEvent`.
 *
 * Fire-and-forget by design: the worker can't await a shell function — the
 * call returns `undefined` in-worker. A callback invoked from a dispatched
 * event lands on the shell in the same postMessage round trip; invoked from
 * a timer/continuation it still routes correctly (realm captured at mount).
 */

/** Reserved emit-op name — payload `{ id, args }`, consumed by the driver. */
export const CALLBACK_EVENT = '__island_cb__';
const CALLBACK_WIRE = '__cb';

/** Marker identity — a WeakSet so a crafted `{ __islandCb }` can't collide. */
const markers = new WeakMap<object, (...args: unknown[]) => void>();

/**
 * Mark a shell function so it can travel as a prop: `mountIsland({ props:
 * { onSave: callbackProp(fn) } })`. In the worker the prop arrives as a
 * callable — invoking it fires `fn(...args)` on the shell asynchronously.
 * The callable returns `undefined` (fire-and-forget — no await channel).
 */
export function callbackProp<Args extends unknown[]>(
  fn: (...args: Args) => void,
): (...args: Args) => void {
  const marker = { fn: fn as (...args: unknown[]) => void };
  markers.set(marker, marker.fn);
  return marker as unknown as (...args: Args) => void;
}

const isPlainObj = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

/**
 * Shell side: walk props replacing `callbackProp` markers with `{ __cb: id }`
 * wire handles — `register` assigns each function a table id. Runs before
 * the structured-clone preflight (markers hold a function — uncloneable).
 */
export function marshalCallbackProps(
  value: unknown,
  register: (fn: (...args: unknown[]) => void) => number,
): unknown {
  const fn = markers.get(value as object);
  if (fn !== undefined) return { [CALLBACK_WIRE]: register(fn) };
  if (Array.isArray(value)) return value.map((v) => marshalCallbackProps(v, register));
  if (!isPlainObj(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = marshalCallbackProps(v, register);
  return out;
}

/**
 * Worker side: walk received props replacing `{ __cb: id }` handles with
 * callables — `make` wraps an id into the emit-backed caller.
 */
export function unmarshalCallbackProps(
  value: unknown,
  make: (id: number) => (...args: unknown[]) => void,
): unknown {
  if (Array.isArray(value)) return value.map((v) => unmarshalCallbackProps(v, make));
  if (!isPlainObj(value)) return value;
  const id = value[CALLBACK_WIRE];
  if (typeof id === 'number' && Object.keys(value).length === 1) return make(id);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = unmarshalCallbackProps(v, make);
  return out;
}
