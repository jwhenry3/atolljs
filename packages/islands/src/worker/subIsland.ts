/**
 * The nested half of `mountIsland` — registered via
 * `registerSubIslandMounter` so the ONE public function serves both mount
 * targets: a real element takes the main-thread DOM driver, a proxy
 * element lands here. This mounter spawns a REAL sub-worker (an ordinary
 * `definePolyWorker`/`defineMonoWorker` entry) inside a worker-rendered
 * island and replays its op batches into proxy DOM nodes of the parent
 * instance's shadow tree.
 *
 * The trick that makes nesting need no new wire format: every proxy-DOM
 * mutation already serializes to an op on the PARENT instance's queue —
 * so replaying the sub-island's ops into proxy nodes tunnels the inner
 * DOM upward through the parent's own op stream. The main thread sees one
 * flat op batch and can't tell which worker produced it.
 *
 *   main mountIsland ──ops──▶ real DOM
 *        ▲  ▲                  (one hop: worker → main)
 *        │  └─ parent instance ops ── proxy mutations ──┐
 *   sub-island ops ──────── mountSubIsland (this file) ─┘
 *
 * Events travel the same path in reverse: a `listen`/`on*` handler on a
 * replayed node becomes a proxy `addEventListener`, which emits a `listen`
 * op to the main thread; the real event dispatches into THIS worker, the
 * proxy listener forwards the payload down to the sub-worker's `dispatch`.
 * Two hops end to end — the doorbell still delivers pushes, since async op
 * application bumps the parent's `opsVersion` like any out-of-task commit.
 *
 * Instance scoping: the sub-instance key minted here is
 * `parent~app@N` (`'dashboard@1~counter@1'`) — globally unique across the
 * worker topology AND self-describing in devtools, where forwarded events
 * already carry the emitting worker's stamp. `appNameOf` still resolves
 * the registry name off the last '@'.
 */
import { emitDevtools, observe } from '@atolljs/core';
import {
  assertCloneableProps,
  connectIslandWorker,
  cssStyleValue,
  registerSubIslandMounter,
  type ConnectIslandWorkerConfig,
  type IslandClient,
  type IslandHandle,
  type Mode,
  type MountIslandOptions,
} from '../island';
import { marshalCallbackProps, CALLBACK_EVENT } from '../callbackProps';
import { isEventRef } from '../ops';
import type { EventPayload, Op, WireProps } from '../ops';
import { getInstanceSize, runInInstance } from './instance';
import type { InternalDocument } from './dom/document';
import { ProxyElement } from './dom/element';
import type { ProxyEventHandler, ProxyNode } from './dom/node';

/**
 * The surface is ONE function: `mountIsland`. A proxy `el` makes the mount
 * nested — these are the same options either way (the `slots`/`onActivity`
 * main-side extras tunnel through the parent's own driver).
 */
export type MountSubIslandOptions = MountIslandOptions;
/** One handle shape for both mount targets — `instance` reads `parent~app@N`. */
export type SubIslandHandle = IslandHandle;

/** Per-context mount counter — the `N` in `parent~app@N`. */
let subSeq = 0;

/**
 * Live sub-island count per shared client — the same contract as
 * mountIsland's `clientMounts`: `destroy()` releases the instance via
 * `unmount` while siblings remain, and the LAST sub-island to leave
 * terminates the sub-worker.
 */
const clientMounts = new WeakMap<object, number>();

/**
 * Enrichment keys the parent worker's proxy DOM synthesizes onto event
 * payloads (see InternalDocument._enrichEvent) — they never cross a wire,
 * so they're stripped before a payload is forwarded down to a sub-worker,
 * which re-enriches `target`/`currentTarget` against ITS OWN shadow tree.
 */
const ENRICHED_KEYS = new Set([
  'target',
  'currentTarget',
  'composedPath',
  'preventDefault',
  'stopPropagation',
  'stopImmediatePropagation',
]);

export async function mountSubIsland(opts: MountSubIslandOptions): Promise<SubIslandHandle> {
  const {
    el, onEvent, onActivity, onOps, client: givenClient, worker, app: givenApp,
    props: givenProps, mode: initialMode, framework, mountTimeout,
    ...workerConfig
  } = opts;
  if (!(el instanceof ProxyElement)) {
    throw new Error(
      'mountSubIsland: `el` must be a ProxyElement of a mounted parent island — ' +
        'a real element mounts through the main-thread driver (mountIsland handles both).',
    );
  }
  const doc = el.doc as InternalDocument;
  const parentInstance = doc.instance;
  const app = givenApp ?? 'main';
  // `~` separates nesting levels — 'dashboard@1~counter@1' reads as
  // 'counter@1 mounted by dashboard@1'. appNameOf still resolves 'counter'.
  const instance = `${parentInstance}~${app}@${++subSeq}`;

  if (givenClient === undefined && worker === undefined) {
    throw new Error(
      'mountSubIsland: pass `worker` (a `() => new Worker(...)`/URL entry — this call builds ' +
        'the island-owned sub-client) or `client` (a shared connectIslandWorker — several ' +
        'sub-islands, one sub-worker)',
    );
  }

  // callbackProp() markers marshal to {__cb:id} wire handles — the SAME
  // protocol the main driver uses, so worker-side functions can cross into
  // the sub-worker and its invocations route back to this table.
  const cbTable = new Map<number, (...args: unknown[]) => void>();
  let cbSeq = 0;
  const registerCb = (fn: (...args: unknown[]) => void): number => {
    cbTable.set(++cbSeq, fn);
    return cbSeq;
  };
  const props = marshalCallbackProps(givenProps ?? {}, registerCb) as Record<string, unknown>;
  assertCloneableProps(props, `mountIsland(${givenApp ?? 'main'})`);

  // Identical client shorthand to the main driver: workerConfig extras
  // (concurrency, taskTimeout, respawn…) pass through; 'poll' builds the
  // client doorbell-free — no SharedArrayBuffer inside the sub-worker.
  const client: IslandClient =
    givenClient ??
    connectIslandWorker({
      ...workerConfig,
      worker: worker!,
      doorbell: initialMode !== 'poll',
    } as ConnectIslandWorkerConfig);
  clientMounts.set(client, (clientMounts.get(client) ?? 0) + 1);

  /** sub-op node id → proxy node (0 is the container sentinel). */
  const nodes = new Map<number, ProxyNode>([[0, el]]);
  /** proxy node instance id → sub-op id — translates dispatched targetIds. */
  const proxyIdToSub = new Map<number, number>([[el.instance.id, 0]]);
  /** sub-id → last applied prop set (for `update` diffing). */
  const prevProps = new Map<number, WireProps>();
  /** sub-id → 'type#handler' → attached proxy listener (kept for removal). */
  const nodeListeners = new Map<number, Map<string, { fn: ProxyEventHandler; capture?: boolean }>>();

  let unsubscribe: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;
  let opsApplied = 0;
  let flushCalls = 0;
  let mode: Mode = initialMode ?? 'push';

  /**
   * A DOM event dispatched into THIS worker, headed one level down: strip
   * the parent-side enrichment and translate `targetId` from the parent's
   * proxy-id space to the sub-worker's node-id space.
   */
  function translatePayload(p: EventPayload): EventPayload {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (!ENRICHED_KEYS.has(k)) out[k] = v;
    }
    if (typeof p.targetId === 'number') {
      const subId = proxyIdToSub.get(p.targetId);
      if (subId !== undefined) out.targetId = subId;
      else delete out.targetId;
    }
    return out as unknown as EventPayload;
  }

  /** The proxy-side listener for a sub-worker's handler id — forwards the
   *  translated payload down and applies whatever ops come back. */
  function dispatchListener(subHid: number): ProxyEventHandler {
    return (payload) => {
      void client
        .dispatch(subHid, translatePayload(payload as EventPayload))
        .then((ops) => applyOps(ops, 'dispatch'))
        .catch((err) => console.error(`[sub-island ${instance}] dispatch failed`, err));
    };
  }

  function trackListener(subId: number, key: string, fn: ProxyEventHandler, capture?: boolean): void {
    let table = nodeListeners.get(subId);
    if (!table) nodeListeners.set(subId, (table = new Map()));
    if (!table.has(key)) table.set(key, { fn, capture });
  }

  function setProp(node: ProxyElement, subId: number, name: string, value: unknown): void {
    if (isEventRef(value)) {
      const eventName = name.slice(2).toLowerCase();
      const key = `${eventName}#${value.__evt}`;
      if (!(nodeListeners.get(subId)?.has(key))) {
        const fn = dispatchListener(value.__evt);
        trackListener(subId, key, fn);
        node.addEventListener(eventName, fn);
      }
      return;
    }
    if (name === 'style' && typeof value === 'object' && value !== null) {
      const next = value as Record<string, unknown>;
      const prev = (prevProps.get(subId)?.style ?? {}) as Record<string, unknown>;
      const style = node.style as unknown as Record<string, string>;
      for (const k of Object.keys(prev)) if (!(k in next)) style[k] = '';
      for (const [k, v] of Object.entries(next)) {
        if (prev[k] !== v) style[k] = cssStyleValue(k, v);
      }
      return;
    }
    if (name === 'className') {
      node.className = String(value);
      return;
    }
    if (value === true) {
      node.setAttribute(name, '');
      return;
    }
    if (value === false) {
      node.removeAttribute(name);
      return;
    }
    // Reflected properties (value, checked, disabled, src, href, tabIndex…)
    // emit attr ops through their accessors; everything else is a plain attr.
    if (name in node) {
      try {
        (node as unknown as Record<string, unknown>)[name] = value;
        return;
      } catch {
        /* read-only accessor — fall back to the attribute */
      }
    }
    node.setAttribute(name, String(value));
  }

  function removeProp(node: ProxyElement, subId: number, name: string, oldValue: unknown): void {
    if (isEventRef(oldValue)) {
      const eventName = name.slice(2).toLowerCase();
      const key = `${eventName}#${oldValue.__evt}`;
      const entry = nodeListeners.get(subId)?.get(key);
      if (entry) {
        node.removeEventListener(eventName, entry.fn, { capture: entry.capture });
        nodeListeners.get(subId)?.delete(key);
      }
      return;
    }
    if (name === 'style') {
      for (const k of Object.keys((oldValue ?? {}) as Record<string, unknown>)) {
        (node.style as unknown as Record<string, string>)[k] = '';
      }
      return;
    }
    if (name === 'className') {
      node.className = '';
      return;
    }
    node.removeAttribute(name);
  }

  function applyProps(node: ProxyElement, subId: number, prev: WireProps, next: WireProps): void {
    for (const name of Object.keys(prev)) {
      if (!(name in next)) removeProp(node, subId, name, prev[name]);
    }
    for (const [name, value] of Object.entries(next)) {
      if (prev[name] !== value || isEventRef(value)) setProp(node, subId, name, value);
    }
  }

  function applyOp(op: Op): void {
    switch (op.t) {
      case 'create': {
        const node =
          op.ns !== undefined ? doc.createElementNS(op.ns, op.type) : doc.createElement(op.type);
        nodes.set(op.id, node);
        proxyIdToSub.set(node.instance.id, op.id);
        for (const [name, value] of Object.entries(op.props)) setProp(node, op.id, name, value);
        prevProps.set(op.id, op.props);
        break;
      }
      case 'text': {
        const node = doc.createTextNode(op.text);
        nodes.set(op.id, node);
        proxyIdToSub.set(node.instance.id, op.id);
        break;
      }
      case 'append': {
        const parent = nodes.get(op.parent) as ProxyElement | undefined;
        const child = nodes.get(op.child);
        if (!parent || !child) {
          console.error(
            `[sub-island] append skipped: parent=${op.parent}→${String(parent)} child=${op.child}→${String(child)}`,
          );
          break;
        }
        // `<template>` children share the .content shadow array — a plain
        // insertBefore emits the template-id append the main driver routes
        // into el.content.
        const before = op.before !== undefined ? (nodes.get(op.before) ?? null) : null;
        parent.insertBefore(child, before);
        break;
      }
      case 'remove': {
        nodes.get(op.child)?.remove();
        break;
      }
      case 'update': {
        const node = nodes.get(op.id);
        if (!(node instanceof ProxyElement)) break;
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
        if (!(node instanceof ProxyElement)) break;
        // `data-atoll-slot` needs no special case: the attr op the proxy
        // emits carries the same name, so the MAIN driver's slot machinery
        // mounts it — nested slots surface on the outer island's `slots`.
        if (op.value === null) node.removeAttribute(op.name);
        else node.setAttribute(op.name, op.value);
        break;
      }
      case 'style': {
        const node = nodes.get(op.id);
        if (!(node instanceof ProxyElement)) break;
        const style = node.style as unknown as Record<string, string>;
        for (const [k, v] of Object.entries(op.props)) style[k] = v;
        // Fold into prevProps so a later `update` prop-diff sees these keys
        // as already applied (same bookkeeping as the main driver's
        // mergeStyle) — otherwise a React style-object diff would re-clear
        // keys the proxy-level style op just wrote.
        const prev = prevProps.get(op.id) ?? {};
        prev.style = { ...((prev.style ?? {}) as Record<string, string>), ...op.props };
        prevProps.set(op.id, prev);
        break;
      }
      case 'listen': {
        const node = nodes.get(op.id);
        if (!(node instanceof ProxyElement) && op.id !== 0) break;
        const target = (node ?? el) as ProxyElement;
        const key = `${op.type}#${op.handler}`;
        if (!(nodeListeners.get(op.id)?.has(key))) {
          const fn = dispatchListener(op.handler);
          trackListener(op.id, key, fn, op.opts?.capture);
          target.addEventListener(op.type, fn, op.opts);
        }
        break;
      }
      case 'unlisten': {
        const node = nodes.get(op.id) as ProxyElement | undefined;
        if (!(node instanceof ProxyElement)) break;
        const key = `${op.type}#${op.handler}`;
        const entry = nodeListeners.get(op.id)?.get(key);
        if (entry) {
          node.removeEventListener(op.type, entry.fn, { capture: op.opts?.capture });
          nodeListeners.get(op.id)?.delete(key);
        }
        break;
      }
      case 'clear': {
        el.replaceChildren();
        break;
      }
      case 'emit': {
        if (op.name === CALLBACK_EVENT) {
          const p = op.payload as { id?: number; args?: unknown[] } | undefined;
          if (p !== null && typeof p === 'object' && typeof p.id === 'number') {
            cbTable.get(p.id)?.(...(p.args ?? []));
          }
          break;
        }
        emitDevtools({ type: 'island:event', instance, name: op.name });
        // Instance scope for the callback only — a re-emit() inside onEvent
        // resolves the ambient instance and must land on the parent's queue.
        runInInstance(parentInstance, () => onEvent?.(op.name, op.payload));
        break;
      }
    }
  }

  function applyOps(ops: Op[], via: 'mount' | 'updateProps' | 'dispatch' | 'setSize' | 'flush'): void {
    opsApplied += ops.length;
    onActivity?.();
    const t0 = performance.now();
    // No runInInstance wrap + no explicit bump: proxy mutations emit their
    // own ops and `ProxyNode._op` already bumps the doorbell whenever the
    // active instance differs (always true — applyOps runs in async
    // continuations, never inside an instance task). A manual bump here
    // would loop: doorbell → flush → empty batch → bump → doorbell → …
    for (const op of ops) applyOp(op);
    const replayMs = performance.now() - t0;
    emitDevtools({ type: 'island:ops', instance, via, count: ops.length, replayMs });
    onOps?.(ops, replayMs);
  }

  /** Times a worker→sub-worker round-trip for the devtools inspector. */
  const islandCall = <T>(
    method: 'mount' | 'whoami' | 'dispatch' | 'setSize' | 'updateProps' | 'flush' | 'unmount',
    p: Promise<T>,
  ): Promise<T> => {
    const t0 = performance.now();
    return p.then(
      (r) => {
        emitDevtools({
          type: 'island:task', instance, method,
          ms: performance.now() - t0,
          ops: Array.isArray(r) ? r.length : undefined,
        });
        return r;
      },
      (err) => {
        emitDevtools({
          type: 'island:task', instance, method,
          ms: performance.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      },
    );
  };

  const doFlush = (): void => {
    if (destroyed) return;
    flushCalls++;
    void islandCall('flush', client.flush(instance)).then((ops) => applyOps(ops, 'flush'));
  };

  /* ── Transport: push (sub-pool's doorbell buffer) vs poll — same shape
   * as the main driver. Observing shared memory inside a worker is legal
   * (Atomics.waitAsync works off the main thread); 'poll' needs no SAB. */
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
    else pollTimer = setInterval(doFlush, 50);
    onActivity?.();
  }

  /* ── Mount handshake ─────────────────────────────────────────────────── */
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
                `mountIsland(${app}): the sub-worker never answered within ${mountMs}ms — ` +
                  'check that the entry module loads and calls definePolyWorker/defineMonoWorker.',
              ),
            ),
          mountMs,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  };

  let pid: string;
  try {
    applyOps(await raced(islandCall('mount', client.mount(instance, props))), 'mount');
    pid = await raced(islandCall('whoami', client.whoami(instance)));
    emitDevtools({
      type: 'island:mount', instance, app, pid,
      poolId: client.pool?.poolId, framework,
    });
  } catch (err) {
    // The instance may exist sub-worker-side with ops never applied — an
    // island-owned client terminates (a broken entry can't respawn-loop);
    // a shared client just drops the instance.
    clientMounts.set(client, (clientMounts.get(client) ?? 1) - 1);
    if (givenClient === undefined) client.terminate();
    else void islandCall('unmount', client.unmount(instance)).catch(() => {});
    throw err;
  }

  // Start the transport now that the handshake landed — same ordering as
  // the main driver ('push' subscribes the doorbell, 'poll' the interval).
  setMode(mode);

  /* ── Pushed-size forwarding ─────────────────────────────────────────────
   * The only geometry channel that exists is the parent island's measured
   * box — forward it as the sub-island's container size (same claim
   * `doc.markContainer` makes: "pretend my box is the container's"). Sub
   * apps that genuinely fill their mount get a usable size; others see the
   * parent's box — honest enough, and the alternative is permanent zeros. */
  const pushSize = (w: number, h: number): void => {
    if (destroyed) return;
    void islandCall('setSize', client.setSize(instance, w, h)).then((ops) => applyOps(ops, 'setSize'));
  };
  doc.onResize(pushSize);
  const initial = getInstanceSize(parentInstance);
  if (initial !== undefined) pushSize(initial.w, initial.h);

  const handle: IslandHandle = {
    app,
    pid,
    instance,
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
      const marshalled = marshalCallbackProps(next, registerCb) as Record<string, unknown>;
      applyOps(await islandCall('updateProps', client.updateProps(instance, marshalled)), 'updateProps');
    },
    flush: async () => {
      applyOps(await islandCall('flush', client.flush(instance)), 'flush');
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      emitDevtools({ type: 'island:unmount', instance });
      unsubscribe?.();
      if (pollTimer !== null) clearInterval(pollTimer);
      const remaining = (clientMounts.get(client) ?? 1) - 1;
      clientMounts.set(client, remaining);
      if (givenClient === undefined || remaining <= 0) client.terminate();
      else void islandCall('unmount', client.unmount(instance)).catch(() => {});
    },
  };
  return handle;
}

// The unified surface: `mountIsland` delegates here when its `el` is a
// proxy element. Registration is module-eval so any worker that imports
// '@atolljs/islands/worker' (every island worker does) makes nested
// mounting work — the main-thread bundle never loads this module.
registerSubIslandMounter(mountSubIsland);
