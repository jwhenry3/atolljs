/**
 * `@atolljs/solid-island/worker` — the Solid worker renderer.
 *
 * `solidIslandApp(Component)` wraps a plain Solid function component into a
 * `RenderedIslandApp` that `definePolyWorker`/`defineMonoWorker` can
 * mount into a instance's PROXY document. Rendering goes through `createRenderer`
 * (the same non-DOM render target `solid-three` uses), whose host options map
 * onto the proxy DOM one-to-one — every node mutation it performs already
 * emits the op stream the main-thread driver replays.
 *
 * Components are PLAIN FUNCTIONS — there is no JSX transform in this repo.
 * Author them with the same primitives babel-preset-solid emits for
 * `generate: 'universal'` with
 * `moduleName: '@atolljs/solid-island/worker'`
 * (`createElement`/`insert`/`setProp`/`createComponent`/`spread`/`effect`/
 * `memo`/`use`/`mergeProps` — all re-exported here), or with the tiny `h()`
 * helper for hand-written trees:
 *
 * ```ts
 * // counter.worker.ts
 * function Counter(props: Record<string, unknown>) {
 *   const [count, setCount] = createSignal(0);
 *   const label = h('span', { class: 'count' });
 *   insert(label, () => `${props.label}: ${count()}`);
 *   const bump = h('button', { class: 'bump' }, 'bump');
 *   bump.addEventListener('click', () => setCount((c) => c + 1));
 *   return h('div', { class: 'counter' }, label, bump);
 * }
 * export const counterApp = islandApp('counter', solidIslandApp(Counter));
 * export const counterWorker = defineMonoWorker(counterApp);
 * ```
 *
 * SEMANTICS:
 * - `mount(ctx)` renders `createComponent(Component, reactiveProps)` into
 *   `ctx.doc.body` inside the mount task's instance scope — the initial tree
 *   arrives as ordinary create/append/attr/listen ops.
 * - `update(props)` mutates the per-key signals backing `reactiveProps`, so
 *   `island.updateProps` produces ONLY the ops the changed reads touch
 *   (utext/attr) — a fine-grained patch, never a rebuild.
 * - `dispose()` runs the Solid root disposer: every owner, effect and
 *   computation created under the mount is torn down before the proxy
 *   document dies.
 * - Ops committed outside tasks (timers, continuations) route by instance
 *   instance and ring the doorbell — the proxy DOM already handles that.
 *
 * BUILD CAVEAT: `solid-js/universal` internally does `import 'solid-js'`,
 * which toolchains that apply the `worker`/`node`/`deno` exports condition
 * resolve to `dist/server.js` — the SSR build whose effects never re-run.
 * Worker bundles MUST pin the client build (alias `solid-js` to
 * `dist/solid.js`/`dist/dev.js`, or drop the condition). See README →
 * "Caveat: the worker/node exports condition".
 */
import {
  createComponent as solidCreateComponent,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  mergeProps,
  untrack,
} from 'solid-js';
import {
  createRenderer,
  type Renderer,
  type RendererOptions,
} from 'solid-js/universal';
import {
  defineMonoWorker,
  definePolyWorker,
  getActiveInstance,
  getLastActiveInstance,
  getLastTouchedInstance,
  islandApp,
  docForInstance,
  ProxyElement,
  ProxyNode,
  ProxyText,
  withContract,
  type DoorbellSpec,
  type IslandContract,
  type IslandWorkerMethods,
  type ProxyDocument,
  type ProxyEventHandler,
  type RenderContext,
  type RenderedHandle,
  type RenderedIslandApp,
} from '@atolljs/islands/worker';
import type { SharedMemory, WorkerDefinition } from '@atolljs/core';

/** A Solid component the worker renderer can mount — props arrive as the
 *  reactive record the wire serialized. */
export type SolidComponent<P = Record<string, unknown>> = (props: P) => unknown;

// Apps emit over the island→shell channel often enough to re-export.
export { emit, runInInstance } from '@atolljs/islands/worker';

/* ── Per-document renderer instances ────────────────────────────────────── */

type AnyRenderer = Renderer<ProxyNode>;
const renderers = new WeakMap<ProxyDocument, AnyRenderer>();
/** Every mount gets ONE renderer bound to its proxy document — a shared
 *  client can host several rendered mounts, and node-less factories
 *  (createElement/createTextNode) must mint ids under the right one. */
const rendererFor = (doc: ProxyDocument): AnyRenderer => {
  let r = renderers.get(doc);
  if (r === undefined) {
    renderers.set(doc, (r = createRenderer(proxyHostOptions(doc))));
  }
  return r;
};

/**
 * The doc a doc-less call belongs to: the active instance's proxy document
 * inside a instance task (mount/update/dispatch always run under one), else
 * the shared ambient fallbacks — the last instance a task ran under, then the
 * instance the most recent pushed op targeted.
 */
const currentDoc = (): ProxyDocument => {
  const instance = getActiveInstance() || getLastActiveInstance() || getLastTouchedInstance();
  if (instance !== '') return docForInstance(instance);
  throw new Error(
    '@atolljs/solid-island: no mounted instance — createElement/createTextNode ' +
      'was called before any solidIslandApp mounted',
  );
};

const eventRebind = (el: ProxyElement, type: string, prev: unknown, value: unknown): void => {
  if (typeof prev === 'function' && prev !== value) {
    el.removeEventListener(type, prev as ProxyEventHandler);
  }
  if (typeof value === 'function') el.addEventListener(type, value as ProxyEventHandler);
};

/** `value` → attribute op. `true` writes 'true' (not '') — the driver
 *  property-write path (`name in node`) would otherwise land `''` → falsy
 *  on reflected booleans like `checked`/`disabled`. */
const writeAttr = (el: ProxyElement, name: string, value: unknown): void => {
  if (value === null || value === undefined || value === false) {
    el.removeAttribute(name);
  } else if (value === true) {
    el.setAttribute(name, 'true');
  } else if (typeof value === 'string' || typeof value === 'number') {
    el.setAttribute(name, String(value));
  }
  // objects/functions have no wire encoding — same drop rule as serializeProps.
};

/**
 * The universal renderer's one prop hook — maps Solid's prop conventions
 * onto the facade, whose mutations all emit ops already:
 * - `on:name` / `onName` functions → addEventListener (→ listen ops; the
 *   driver dispatches the wire EventPayload back to the handler table).
 * - `textContent`/`innerHTML`/`innerText` → the facade properties.
 * - `class`/`className` → className; `classList` → per-key toggles;
 *   `classList:name` → a single toggle.
 * - `style` → style-proxy keys (each change emits one `style` op) or a
 *   `style="…"` attribute string.
 * - `attr:`/`bool:`/`prop:`/`use:` namespace prefixes → attribute /
 *   presence-attribute / reflected-property / directive-arg writes.
 * - `ref` invokes the callback with the element; `children`/`key` are
 *   ignored (structure lives in insert ops).
 * - everything else → `setAttribute`; `false`/`null`/`undefined` removes.
 */
const setProperty = (node: ProxyNode, name: string, value: unknown, prev?: unknown): void => {
  const el = node as ProxyElement;
  if (name === 'children' || name === 'key') return;
  if (name === 'ref') {
    if (typeof value === 'function') value(el);
    return;
  }
  if (name.startsWith('on:')) {
    eventRebind(el, name.slice(3), prev, value);
    return;
  }
  if (/^on[A-Z]/.test(name)) {
    eventRebind(el, name.slice(2).toLowerCase(), prev, value);
    return;
  }
  if (name === 'textContent' || name === 'innerText') {
    el.textContent = value === null || value === undefined ? '' : String(value);
    return;
  }
  if (name === 'innerHTML') {
    el.innerHTML = value === null || value === undefined ? '' : String(value);
    return;
  }
  if (name === 'class' || name === 'className') {
    el.className = value === null || value === undefined || value === false ? '' : String(value);
    return;
  }
  if (name === 'classList' && typeof value === 'object' && value !== null) {
    const prevList = (typeof prev === 'object' && prev !== null ? prev : {}) as Record<string, unknown>;
    const next = value as Record<string, unknown>;
    for (const k of Object.keys(prevList)) if (!(k in next)) el.classList.remove(k);
    for (const k of Object.keys(next)) el.classList.toggle(k, !!next[k]);
    return;
  }
  if (name.startsWith('classList:')) {
    el.classList.toggle(name.slice(10), !!value);
    return;
  }
  if (name === 'style') {
    if (value === null || value === undefined || value === false) {
      el.removeAttribute('style');
    } else if (typeof value === 'string') {
      el.setAttribute('style', value);
    } else if (typeof value === 'object') {
      const next = value as Record<string, string>;
      const prevStyle = (typeof prev === 'object' && prev !== null ? prev : {}) as Record<string, string>;
      const style = el.style as unknown as Record<string, string>;
      for (const k of Object.keys(prevStyle)) if (!(k in next)) style[k] = '';
      for (const k of Object.keys(next)) style[k] = next[k];
    }
    return;
  }
  if (name.startsWith('style:')) {
    (el.style as unknown as Record<string, string>)[name.slice(6)] =
      value === null || value === undefined ? '' : String(value);
    return;
  }
  if (name.startsWith('attr:')) {
    writeAttr(el, name.slice(5), value);
    return;
  }
  if (name.startsWith('bool:')) {
    const attr = name.slice(5);
    if (value) el.setAttribute(attr, 'true');
    else el.removeAttribute(attr);
    return;
  }
  if (name.startsWith('prop:')) {
    // Reflected-property write — the facade's accessors emit attr ops for
    // known names; unknown ones stay worker-side expandos (they can't
    // cross the wire anyway).
    (el as unknown as Record<string, unknown>)[name.slice(5)] = value;
    return;
  }
  if (name.startsWith('use:')) {
    // Directive args ride the compiled `use(fn, el, arg)` call instead —
    // a literal `use:name` prop just records the arg on the element.
    (el as unknown as Record<string, unknown>)[name] = value;
    return;
  }
  writeAttr(el, name, value);
};

const proxyHostOptions = (doc: ProxyDocument): RendererOptions<ProxyNode> => ({
  createElement: (tag) => doc.createElement(tag),
  createTextNode: (value) => doc.createTextNode(String(value)),
  isTextNode: (node) => node instanceof ProxyText,
  // `textContent` on a ProxyText emits the utext op; on a phantom (the
  // shadow child an element's textContent setter leaves) it retargets the
  // parent — either way the wire write is correct.
  replaceText: (node, value) => {
    node.textContent = value;
  },
  setProperty,
  insertNode: (parent, node, anchor) => {
    parent.insertBefore(node, anchor ?? null);
  },
  removeNode: (parent, node) => {
    parent.removeChild(node);
  },
  getParentNode: (node) => node.parentNode ?? undefined,
  getFirstChild: (node) => node.firstChild ?? undefined,
  getNextSibling: (node) => node.nextSibling ?? undefined,
});

/* ── Reactive wire props ────────────────────────────────────────────────── */

/**
 * Serialized props become getter-driven Solid props: one lazy signal per
 * key behind a Proxy, so `props.label` reads track at the KEY level and
 * `updateProps` bumps only the keys that changed — the DOM patch that
 * falls out is as fine-grained as the reads. `has`/`ownKeys` mirror the
 * latest key set so `'x' in props`, `{...props}` and `Object.keys` behave
 * like ordinary props objects.
 */
const wireProps = (initial: Record<string, unknown>): {
  props: Record<string, unknown>;
  update: (next: Record<string, unknown>) => void;
} => {
  let latest: Record<PropertyKey, unknown> = initial;
  const keys = new Set<string | symbol>(Reflect.ownKeys(initial));
  // Membership is reactive too — `key in props`/`Object.keys(props)` inside
  // a component must re-run when updateProps adds or drops a key, not just
  // when a read value changes.
  const [keysVersion, bumpKeys] = createSignal(0);
  const signals = new Map<string | symbol, ReturnType<typeof createSignal<unknown>>>();
  const sigFor = (key: string | symbol): ReturnType<typeof createSignal<unknown>> => {
    let s = signals.get(key);
    if (s === undefined) signals.set(key, (s = createSignal<unknown>(latest[key])));
    return s;
  };
  const props = new Proxy({} as Record<string, unknown>, {
    get: (_t, key) => sigFor(key)[0](),
    // Props are read-only — swallow writes instead of throwing into a
    // component that legitimately believed it owned a plain object.
    set: () => true,
    has: (_t, key) => {
      keysVersion();
      return keys.has(key);
    },
    ownKeys: () => {
      keysVersion();
      return [...keys];
    },
    getOwnPropertyDescriptor: (_t, key) =>
      keys.has(key)
        ? {
            configurable: true,
            enumerable: true,
            // Accessor descriptor — a value-less descriptor makes
            // spreads/`Object.values` see undefined for live props.
            get: () => sigFor(key)[0](),
          }
        : undefined,
  });
  const update = (next: Record<string, unknown>): void => {
    latest = next as Record<PropertyKey, unknown>;
    let keysChanged = false;
    for (const key of Reflect.ownKeys(next)) {
      if (!keys.has(key)) keysChanged = true;
      keys.add(key);
      // `() => v` forces value semantics — a function-typed prop would
      // otherwise be mistaken for the updater form.
      sigFor(key)[1](() => next[key as keyof typeof next]);
    }
    for (const key of keys) {
      if (!(key in next)) {
        keys.delete(key);
        keysChanged = true;
        signals.get(key)?.[1](() => undefined);
      }
    }
    if (keysChanged) bumpKeys((v) => v + 1);
  };
  return { props, update };
};

/* ── The app wrapper ────────────────────────────────────────────────────── */

/**
 * Fail fast on the SSR-build footgun: toolchains that apply the `worker`/
 * `node`/`deno` exports condition resolve `solid-js` to `dist/server.js`,
 * where effects NEVER re-run — the island mounts and silently stays frozen.
 * Probe it once at the first mount: bump a signal an effect reads and
 * require the second run (the server build's createRenderEffect runs fn
 * once at creation and nothing ever re-fires).
 */
let reactivityVerified = false;
const assertClientBuild = (): void => {
  if (reactivityVerified) return;
  reactivityVerified = true;
  let runs = 0;
  // The write must land AFTER the root's create pass returns — a set issued
  // while the effect is still mid-subscription is swallowed by the
  // updatedAt bookkeeping in any build, so this separates "never re-runs"
  // (server) from "re-runs" (client).
  let bump: ((v: number) => number) | undefined;
  createRoot(() => {
    const [tick, setTick] = createSignal(0);
    bump = setTick;
    createRenderEffect(() => {
      tick();
      runs++;
    });
  });
  bump?.(1);
  if (runs < 2) {
    throw new Error(
      '[atoll-solid-island] `solid-js` resolved to its server (SSR) build — effects never ' +
        're-run, so this island would mount frozen. Pin the client build in the worker bundle: ' +
        "alias 'solid-js' → 'solid-js/dist/solid.js', or drop 'worker'/'node' from " +
        'resolve.conditions. See the atoll-solid-island README → "the worker/node exports condition".',
    );
  }
};

/**
 * Wrap a plain Solid component into a `RenderedIslandApp` for
 * `definePolyWorker`/`defineMonoWorker` — usually stamped with
 * `islandApp(name, solidIslandApp(Component))` so the shell can mount by
 * component reference.
 */
export function solidIslandApp<P extends Record<string, unknown>>(
  Component: SolidComponent<P>,
  contract?: IslandContract<P>,
): RenderedIslandApp {
  const app: RenderedIslandApp = {
    mount({ doc, props }: RenderContext): RenderedHandle {
      assertClientBuild();
      const renderer = rendererFor(doc);
      const wire = wireProps(props);
      // render() owns a createRoot — its disposer tears down the component,
      // its signals, and every render effect under it.
      const dispose = renderer.render(
        () =>
          renderer.createComponent(
            Component as unknown as (props: Record<string, unknown>) => ProxyNode,
            wire.props,
          ) as ProxyNode,
        doc.body,
      );
      return {
        update: (next) => wire.update(next),
        dispose,
      };
    },
  };
  // Contract stamp — the engine validates mount/updateProps props and
  // declared emit payloads against it.
  return contract !== undefined ? withContract(contract, app) : app;
}

/** Stamp + wrap in one step — `solidIsland('counter', Counter)` yields the
 *  registry value AND the component-reference handle the shell can mount. */
export const solidIsland = <P extends Record<string, unknown>>(
  name: string,
  Component: SolidComponent<P>,
  contract?: IslandContract<P>,
): RenderedIslandApp & { readonly islandAppName: string } =>
  islandApp(name, solidIslandApp(Component, contract));

export interface SolidPolyWorkerRegistry {
  /** Name → Solid component registry, mirroring `definePolyWorker({ apps })`. */
  apps: Record<string, SolidComponent>;
  /** Doorbell contract override — forwarded to `definePolyWorker`. */
  sharedMemory?: SharedMemory<DoorbellSpec>;
}

/**
 * `definePolyWorker` for Solid apps — maps each component in the registry
 * through `solidIslandApp` and delegates. One worker, many Solid islands.
 */
export function defineSolidPolyWorker(
  registry: SolidPolyWorkerRegistry,
  options?: { sharedMemory?: SharedMemory<DoorbellSpec> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  const apps: Record<string, RenderedIslandApp> = {};
  for (const [name, component] of Object.entries(registry.apps)) {
    apps[name] = solidIslandApp(component);
  }
  return definePolyWorker({
    apps,
    sharedMemory: registry.sharedMemory ?? options?.sharedMemory,
  });
}

/**
 * `defineMonoWorker` for Solid apps — one worker pinned to a single
 * component, the isolated-bundle host shape.
 */
export function defineSolidMonoWorker<P extends Record<string, unknown>>(
  component: SolidComponent<P>,
  options?: { sharedMemory?: SharedMemory<DoorbellSpec>; contract?: IslandContract<P> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  return defineMonoWorker(solidIslandApp(component, options?.contract), options);
}

/* ── Compiled-JSX / hand-authoring primitives ─────────────────────────────
 *
 * These are the surface `babel-preset-solid` emits calls into for
 * `{ generate: 'universal', moduleName: '@atolljs/solid-island/worker' }`.
 * Node-bound calls dispatch by `node.doc` (always the right instance, even
 * outside a task scope); the doc-less factories fall back to the active
 * instance / last-mounted document. */

export const createElement = (tag: string): ProxyElement => currentDoc().createElement(tag);

export const createTextNode = (value: unknown): ProxyText =>
  currentDoc().createTextNode(String(value));

/** `insert(parent, accessor, marker?, initial?)` — the universal renderer's
 *  expression inserter: strings/numbers become text nodes, functions become
 *  tracked render effects, arrays reconcile, nodes attach. */
export const insert = (
  parent: ProxyNode,
  accessor: unknown,
  marker?: ProxyNode | null,
  initial?: unknown,
): ProxyNode =>
  rendererFor(parent.doc).insert(parent, accessor as () => unknown, marker, initial);

export const insertNode = (parent: ProxyNode, node: ProxyNode, anchor?: ProxyNode): void =>
  rendererFor(parent.doc).insertNode(parent, node, anchor);

export const spread = (node: ProxyNode, accessor: unknown, skipChildren?: boolean): void =>
  rendererFor(node.doc).spread(node, accessor as () => Record<string, unknown>, skipChildren);

export const setProp = <T>(node: ProxyNode, name: string, value: T, prev?: T): T => {
  setProperty(node, name, value, prev);
  return value;
};

/** `render(code, el)` — mount `code()`'s output under `el`; returns the
 *  Solid root disposer. */
export const render = (code: () => ProxyNode, el: ProxyNode): (() => void) =>
  rendererFor(el.doc).render(code, el);

// solid-js's createComponent is typed for DOM components (returns
// JSX.Element) — the runtime is component-type-agnostic, so loosen the
// signature rather than force ProxyNode into a DOM shape.
export const createComponent = <P>(Comp: (props: P) => unknown, props: P): unknown =>
  (solidCreateComponent as unknown as (comp: (p: P) => unknown, p: P) => unknown)(Comp, props);

export const effect = createRenderEffect;
export const memo = <T>(fn: () => T): (() => T) => createMemo(fn);
export const use = <A, T>(fn: (el: ProxyNode, arg: A) => T, el: ProxyNode, arg: A): T =>
  untrack(() => fn(el, arg));
export { mergeProps };

/**
 * `h(tag, props?, ...children)` — the hand-authoring helper this package's
 * fixtures use: props pass through `setProperty`, children through `insert`
 * (strings become text nodes, functions stay tracked, arrays flatten).
 */
export function h(
  tag: string,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
): ProxyElement {
  const el = currentDoc().createElement(tag);
  if (props != null) for (const [k, v] of Object.entries(props)) setProperty(el, k, v);
  if (children.length === 1) insert(el, children[0]);
  else if (children.length > 1) insert(el, children);
  return el;
}
