/**
 * `@jwhenry123/mesh-vue-island/worker` — the worker-side half of Vue
 * islands: `vueIslandApp(Component)` wraps a Vue component as a worker-dom
 * `RenderedIslandApp`, so it can sit in a `defineIslandWorker` `apps`
 * registry beside React and imperative apps:
 *
 *   // render.worker.ts
 *   import { defineVueIslandWorker } from '@jwhenry123/mesh-vue-island/worker';
 *   export const renderWorker = defineVueIslandWorker({ apps: { counter: Counter } });
 *
 * Vue's public `createRenderer` drives the realm's ProxyDocument — every
 * proxy mutation already serializes to ops, so this file only maps the
 * host-op interface (createElement/insert/patchProp/…) onto the facade.
 *
 * REALM RESOLUTION: the renderer is module-level (shared across realms), so
 * the create* host ops — the only ones that receive no node argument —
 * resolve the realm's ProxyDocument via `getActiveRealm()`. Vue's scheduler
 * flushes state-driven re-renders on a microtask OUTSIDE any task, so the
 * fallback chain runs through worker-dom's own `getLastActiveRealm` (last
 * realm a task held) and finally a last-touched-realm stamp (recorded by
 * every host op that sees a node) to keep late commits on the right
 * document. Consequence: renders
 * triggered by dispatched events commit after the dispatch task returns;
 * their ops ride the doorbell/flush() path rather than the task batch —
 * the listener round-trip still replays them, one microtask later.
 */
import { cloneVNode, createRenderer, h, normalizeClass, normalizeStyle } from 'vue';
import type { App, Component, ElementNamespace, VNode } from 'vue';
import {
  defineIslandWorker,
  getActiveRealm,
  getLastActiveRealm,
  islandApp,
  realmDocFor,
} from '@jwhenry123/mesh-worker-dom/worker';
import type {
  DoorbellSpec,
  EventPayload,
  InternalDocument,
  IslandWorkerMethods,
  ProxyElement,
  ProxyNode,
  RenderContext,
  RenderedHandle,
  RenderedIslandApp,
} from '@jwhenry123/mesh-worker-dom/worker';
import type { SharedMemory, WorkerDefinition } from '@jwhenry123/mesh/sdk';

// Worker entries shouldn't need a second package specifier for the
// island→shell channel — `import { emit } from 'mesh-vue-island/worker'`.
export { emit, runInRealm } from '@jwhenry123/mesh-worker-dom/worker';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATH_NS = 'http://www.w3.org/1998/Math/MathML';

/**
 * The realm create* ops should bind to when no task is running — the last
 * realm whose nodes the renderer touched. Worker-initiated renders (Vue's
 * microtask flush after a dispatched handler mutates state) run with no
 * active realm; in the one-realm-per-worker norm — and in every task —
 * this resolves identically to ambient realm state.
 */
let ambientRealm = '';
const touchRealm = (node: ProxyNode): void => {
  ambientRealm = node.doc.realm;
};

/** The document create* ops write into — the active realm's when a task
 *  holds one; otherwise the last realm a task ran under (worker-dom's own
 *  `getLastActiveRealm` tracking, stamped by every realm task and
 *  markRealmActive), with the renderer's last-touched realm as the final
 *  fallback for nodes reached without any prior task. */
const docForRender = (): InternalDocument =>
  realmDocFor(getActiveRealm() || getLastActiveRealm() || ambientRealm);

/* ── patchProp helpers ─────────────────────────────────────────────────── */

const isOn = (key: string): boolean => /^on[^a-z]/.test(key);
const isModelListener = (key: string): boolean => key.startsWith('onUpdate:');
const OPTIONS_MODIFIER = /(?:Once|Passive|Capture)$/;
const camelize = (k: string): string => k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
const hyphenate = (k: string): string => k.replace(/\B([A-Z])/g, '-$1').toLowerCase();

/** The once/passive/capture flags a modifier suffix encodes — the wire's
 *  `opts` field on listen/unlisten ops. */
interface EventOpts {
  once?: boolean;
  passive?: boolean;
  capture?: boolean;
}

/**
 * 'onClickOnceCapture' → { name: 'click', opts: {once, capture} } — the
 * modifier suffixes become real listener options now that the `listen` op
 * carries `opts` (worker-side `once` also auto-detaches, matching the real
 * listener's own once semantics). 'onX:y' names (e.g. custom
 * 'onUpdate:modelValue'-style events) keep their colon form like
 * runtime-dom.
 */
const parseEventName = (raw: string): { name: string; opts: EventOpts } => {
  let name = raw;
  const opts: EventOpts = {};
  let m: RegExpMatchArray | null;
  while ((m = name.match(OPTIONS_MODIFIER)) !== null) {
    name = name.slice(0, name.length - m[0].length);
    (opts as Record<string, boolean>)[m[0].toLowerCase()] = true;
  }
  return { name: name[2] === ':' ? name.slice(3) : hyphenate(name.slice(2)), opts };
};

/**
 * Per-element event invokers — the same shape as runtime-dom's `_vei` and
 * realm.ts's `listenerSlots`: one stable function per (el, event) whose
 * `value` is the CURRENT handler, so the proxy's addEventListener (and its
 * handler-table id + listen op) is attached exactly once while the invoked
 * closure tracks prop updates. The invoker also remembers the `rawKey` and
 * `opts` it attached with: a modifier change (onClick → onClickOnce) is a
 * DIFFERENT listener on the same event name — the stale one is detached
 * and a fresh listen op goes out with the new options.
 */
type Invoker = ((e: EventPayload) => void) & {
  value?: unknown;
  rawKey?: string;
  opts?: EventOpts;
};
const invokers = new WeakMap<ProxyElement, Map<string, Invoker>>();

function patchEvent(el: ProxyElement, rawKey: string, nextValue: unknown): void {
  const { name, opts } = parseEventName(rawKey);
  // Capture listeners are distinct listeners in the DOM (dedupe is on
  // (type, fn, capture)), so a capture binding gets its own slot;
  // once/passive don't change listener identity — they ride `opts`.
  const key = opts.capture === true ? `${name}|capture` : name;
  let table = invokers.get(el);
  const existing = table?.get(key);
  if (nextValue !== null && nextValue !== undefined) {
    if (existing !== undefined && existing.rawKey === rawKey) {
      // Same binding — the modifiers are part of the raw key, so the
      // options can't have changed; just swap the handler closure.
      existing.value = nextValue;
      return;
    }
    // A different modifier binding claims this event name — detach the
    // stale listener before attaching with THIS binding's options.
    if (existing !== undefined) el.removeEventListener(name, existing, existing.opts);
    const invoker = ((e: EventPayload) => {
      const v = invoker.value;
      if (Array.isArray(v)) for (const fn of v) (fn as (e: EventPayload) => void)(e);
      else if (typeof v === 'function') (v as (e: EventPayload) => void)(e);
    }) as Invoker;
    invoker.value = nextValue;
    invoker.rawKey = rawKey;
    invoker.opts = opts;
    if (table === undefined) invokers.set(el, (table = new Map()));
    table.set(key, invoker);
    el.addEventListener(name, invoker, opts);
  } else if (existing !== undefined && existing.rawKey === rawKey && table !== undefined) {
    // Only the binding that attached the entry may remove it — Vue patches
    // removals AFTER additions, so by the time the old rawKey's null patch
    // arrives a different binding may already own the slot.
    table.delete(key);
    el.removeEventListener(name, existing, existing.opts);
  }
}

/**
 * The proxy DOM's style facade emits one `style` op per written key and
 * '' clears a key — Vue's own diffing (prev vs next) is replayed here so
 * removed style keys clear driver-side too. Keys are camelized: the driver
 * assigns `el.style[key]`, which real DOM only honors in camelCase.
 * Custom properties (`--x`) pass through but the driver's mergeStyle can't
 * setProperty them — a known protocol gap, not renderer-local.
 */
function patchStyle(el: ProxyElement, prev: unknown, next: unknown): void {
  const style = el.style as unknown as Record<string, string>;
  const nextObj = normalizeStyle(next);
  if (typeof nextObj === 'object' && nextObj !== null) {
    const prevObj =
      typeof prev === 'object' && prev !== null && !Array.isArray(prev)
        ? (prev as Record<string, unknown>)
        : {};
    for (const key of Object.keys(prevObj)) {
      if (!(key in nextObj)) style[camelize(key)] = '';
    }
    for (const [key, value] of Object.entries(nextObj)) {
      const k = key.startsWith('--') ? key : camelize(key);
      const v = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
      if ((prevObj as Record<string, unknown>)[key] !== value) style[k] = v;
    }
  } else if (typeof nextObj === 'string') {
    style.cssText = nextObj;
  } else {
    style.cssText = '';
  }
}

/**
 * Form-state props the proxy reflects (`value`/`checked`/`disabled` are
 * attribute-backed accessors — writing them already emits attr ops);
 * `selected`-style booleans fall back to attribute presence.
 */
const FORM_PROPS = /^(value|checked|selected|disabled)$/;

/* ── The host-op surface ───────────────────────────────────────────────── */

const { render, createApp } = createRenderer<ProxyNode, ProxyElement>({
  patchProp(el, key, prevValue, nextValue, _namespace, _parentComponent) {
    touchRealm(el);
    if (key === 'class' || key === 'className') {
      el.className = normalizeClass(nextValue);
      return;
    }
    if (key === 'style') {
      patchStyle(el, prevValue, nextValue);
      return;
    }
    if (isOn(key)) {
      // v-model's compiled listeners never make sense on bare elements.
      if (!isModelListener(key)) patchEvent(el, key, nextValue);
      return;
    }
    if (key === 'innerHTML') {
      el.innerHTML = nextValue == null ? '' : String(nextValue);
      return;
    }
    if (key === 'textContent') {
      el.textContent = nextValue == null ? '' : String(nextValue);
      return;
    }
    if (FORM_PROPS.test(key) && key in el) {
      // Property write on the proxy's reflected accessor — emits the attr
      // op (and keeps the shadow property in sync for reads).
      (el as unknown as Record<string, unknown>)[key] =
        key === 'value' ? (nextValue ?? '') : Boolean(nextValue);
      return;
    }
    if (nextValue === null || nextValue === undefined || nextValue === false) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, nextValue === true ? '' : String(nextValue));
    }
  },
  insert(el, parent, anchor) {
    touchRealm(el);
    parent.insertBefore(el, anchor ?? null);
  },
  remove(el) {
    touchRealm(el);
    el.remove();
  },
  createElement(type, namespace?: ElementNamespace) {
    const doc = docForRender();
    if (namespace === 'svg') return doc.createElementNS(SVG_NS, type);
    if (namespace === 'mathml') return doc.createElementNS(MATH_NS, type);
    return doc.createElement(type);
  },
  createText(text) {
    return docForRender().createTextNode(text);
  },
  // Vue uses comments only as anchors (v-if/v-show/fragment boundaries) —
  // a ProxyComment is nodeType 8 worker-side over a REAL empty text node
  // driver-side, so it anchors `before:` positions like a real comment.
  createComment(text) {
    return docForRender().createComment(text);
  },
  setText(node, text) {
    touchRealm(node);
    node.textContent = text;
  },
  setElementText(el, text) {
    touchRealm(el);
    el.textContent = text;
  },
  parentNode(node) {
    touchRealm(node);
    // Children of a fragment are spliced into the real parent, so a node's
    // recorded parent is always an element (or the id-0 root ProxyElement).
    return node.parentNode as ProxyElement | null;
  },
  nextSibling(node) {
    touchRealm(node);
    return node.nextSibling;
  },
  setScopeId(el, id) {
    el.setAttribute(id, '');
  },
});

/* ── Public API ────────────────────────────────────────────────────────── */

/**
 * Wrap a Vue component as a `RenderedIslandApp` — mount renders it into the
 * realm's proxy document; `handle.update` clones the mounted root vnode with
 * new props and re-`render()`s it, so Vue diffs the live tree synchronously
 * and the changed ops ride back inside the updateProps task batch;
 * `dispose` unmounts the app.
 */
export function vueIslandApp(Component: Component): RenderedIslandApp {
  return {
    mount({ realm, doc, props }: RenderContext): RenderedHandle {
      ambientRealm = realm;
      const container = doc.body;
      const app: App = createApp(Component, props);
      app.mount(container);
      return {
        update(next: Record<string, unknown>): void {
          // render() patches against container._vnode synchronously — Vue
          // diffs the live tree and emits only changed ops, so they ride
          // back inside the updateProps task batch. cloneVNode the MOUNTED
          // root vnode: createApp normalizes the root component into a
          // different object than the one we were handed, and a fresh
          // h(Component) vnode would fail isSameVNodeType → unmount+remount.
          const prev = (container as unknown as { _vnode?: VNode })._vnode;
          if (prev === undefined || prev === null) {
            render(h(Component, next), container);
            return;
          }
          const vnode = cloneVNode(prev);
          // Props REPLACE the previous set (cloneVNode's own extraProps arg
          // merges, which would keep stale keys alive).
          vnode.props = next as VNode['props'];
          render(vnode, container);
        },
        dispose(): void {
          app.unmount();
        },
      };
    },
  };
}

/** Stamp + wrap in one step — `vueIsland('counter', Counter)` yields the
 *  registry value AND the component-reference handle the shell can mount. */
export const vueIsland = (
  name: string,
  Component: Component,
): RenderedIslandApp & { readonly islandAppName: string } =>
  islandApp(name, vueIslandApp(Component));

export interface DefineVueIslandWorkerRegistry {
  /** Name → Vue component registry, mirroring `defineIslandWorker({ apps })`. */
  apps: Record<string, Component>;
  /** Doorbell contract override — forwarded to `defineIslandWorker`. */
  sharedMemory?: SharedMemory<DoorbellSpec>;
}

/** Either a single component (1:1 realm worker) or an `{ apps }` registry. */
export type DefineVueIslandWorkerInput = Component | DefineVueIslandWorkerRegistry;

const isVueRegistry = (
  input: DefineVueIslandWorkerInput,
): input is DefineVueIslandWorkerRegistry =>
  typeof input === 'object' && input !== null && 'apps' in input;

/**
 * `defineIslandWorker` for Vue apps — maps each component through
 * `vueIslandApp` and delegates. A bare component registers as the worker's
 * single app ('main'); an `{ apps }` object registers a name-addressable
 * registry.
 */
export function defineVueIslandWorker(
  input: DefineVueIslandWorkerInput,
  options?: { sharedMemory?: SharedMemory<DoorbellSpec> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  if (isVueRegistry(input)) {
    const apps: Record<string, RenderedIslandApp> = {};
    for (const [key, component] of Object.entries(input.apps)) {
      apps[key] = vueIslandApp(component);
    }
    return defineIslandWorker({
      apps,
      sharedMemory: input.sharedMemory ?? options?.sharedMemory,
    });
  }
  return defineIslandWorker(vueIslandApp(input), options);
}
