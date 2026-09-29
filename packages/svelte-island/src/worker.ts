/**
 * `@jwhenry123/mesh-svelte-island/worker` — the Svelte 5 worker renderer.
 *
 * `svelteIslandApp(Component)` wraps a compiled `.svelte` component into a
 * `RenderedIslandApp` that `definePolyWorker`/`defineMonoWorker` mount
 * into a instance's PROXY document. Rendering goes through the real
 * `mount()`/`unmount()`/`flushSync()` client API — the proxy facade's
 * mutations already serialize to ops, so the adapter's work is the DOM
 * surface the Svelte runtime expects but the facade lacks:
 *
 * ```ts
 * // counter.worker.ts
 * import Counter from './Counter.svelte';
 * export const counterApp = islandApp('counter', svelteIslandApp(Counter));
 * export const counterWorker = defineMonoWorker(counterApp);
 * ```
 *
 * COMPAT — most of the DOM surface Svelte's client runtime touches now
 * lives in the proxy DOM itself (`@jwhenry123/mesh-islands` upstream):
 * `ProxyComment` + `document.createComment` (nodeType 8 over a real EMPTY
 * text node driver-side, so `<!>` block anchors keep a `before:`-able
 * position while `data` writes stay shadow-only), the comment-preserving
 * innerHTML parse (`from_html` bakes `{#if}`/`{#each}`/`{@html}` anchors
 * into template HTML as `<!>` comments — upstream `parseChildren`
 * materializes them), kind-aware `cloneNode` (comments/fragments/ns),
 * `nodeName` + the ChildNode/ParentNode conveniences (`anchor.before(dom)`
 * is how every compiled tree inserts), `namespaceURI` + `*AttributeNS`,
 * `template.content`, `document.importNode`/`baseURI`, listener
 * this-binding + a synthesized `event.composedPath()` (upstream
 * `_enrichEvent` — Svelte's delegated `handle_event_propagation` reads
 * `this` as the handler element and walks the path), listener options +
 * `once`, and the `Node`/`Text`/`Comment` globals + `HTMLMediaElement`/
 * `customElements` stubs `installInstanceDispatcher` installs — which
 * `definePolyWorker`/`defineMonoWorker` already call, BEFORE mount so
 * `init_operations()` caches the proxy prototypes and `first instanceof
 * Comment` resolves against the real upstream ProxyComment.
 *
 * What remains shimmed adapter-side is Svelte-SPECIFIC, installed lazily at
 * the first svelteIslandApp mount:
 * - `flushSync()` after each wrapped listener dispatch — Svelte schedules
 *   its DOM patch on a microtask; flushing inside the handler lands the
 *   patch in the dispatch return batch, same sync-commit semantics as the
 *   React mounts.
 * - The mount-root/document double-registration dedupe — Svelte attaches
 *   the SAME `handle_event_propagation` to `[target, document]`; both
 *   replay as `listen` ops on driver-side id 0 (the island container), so
 *   forwarding twice would dispatch every event twice.
 *
 * SEMANTICS:
 * - `mount(ctx)` mounts into `ctx.doc.body` with a `$state`-backed props
 *   box (props.svelte.ts) — `$.prop` getters read `$$props[key]` lazily, so
 *   a `$state` record makes every mount-prop read tracked.
 * - `update(props)` mutates the box and `flushSync()`es — a fine-grained
 *   patch (only the ops changed reads touch) riding the updateProps batch.
 *   NO rebuild; DOM nodes survive prop changes.
 * - `dispose()` calls `unmount(component)` — the component root tears down
 *   before the instance's proxy document dies.
 *
 * LIMITATIONS: effects driven by user `$effect`/`onMount` or async sources
 * commit outside tasks — their ops queue and ring the doorbell, so they
 * arrive on `island.setMode('push')`/`'poll'` or `island.flush()`, not in a
 * return batch (same contract as React passive effects). Ambient `document`
 * outside tasks resolves to the single/last-active instance — shared-client
 * multi-instance mounts should keep worker-initiated work inside
 * `runInInstance`. `<svelte:head>`/`window`, custom elements, transitions and
 * measured geometry are outside the facade's contract.
 */
import { flushSync, mount as svelteMount, unmount, type Component } from 'svelte';
import {
  defineMonoWorker,
  definePolyWorker,
  islandApp,
  ProxyElement,
} from '@jwhenry123/mesh-islands/worker';
import type {
  DoorbellSpec,
  InternalDocument,
  IslandWorkerMethods,
  ProxyDocument,
  ProxyEventHandler,
  RenderContext,
  RenderedHandle,
  RenderedIslandApp,
} from '@jwhenry123/mesh-islands/worker';
import type { SharedMemory, WorkerDefinition } from '@jwhenry123/mesh/sdk';
import { createPropsBox } from './props.svelte';

/** A compiled Svelte 5 component — what `mount()` accepts. */
export type SvelteIslandComponent<P extends Record<string, unknown> = Record<string, unknown>> =
  Component<P>;

// Island components emit over the island→shell channel often enough to
// re-export — `import { emit } from '@jwhenry123/mesh-svelte-island/worker'`.
export { emit, runInInstance } from '@jwhenry123/mesh-islands/worker';

/* ── Listener wrapping ──────────────────────────────────────────────────── */

/** node → type → original fn → the wrapped fn actually registered (null =
 *  skipped by the id-0 dedupe — see sharedForwarded). */
const listenerWraps = new WeakMap<
  object,
  Map<string, Map<ProxyEventHandler, ProxyEventHandler | null>>
>();
/**
 * document → type → fns already forwarded for an id-0 target. Svelte's
 * mount attaches `handle_event_propagation` to BOTH the mount target
 * (`doc.body`) and `document` — both replay as `listen` ops on the same
 * driver-side container (id 0), so the second identical registration would
 * dispatch every event twice.
 */
const sharedForwarded = new WeakMap<InternalDocument, Map<string, Set<ProxyEventHandler>>>();

/** Record `fn` in the shared id-0 forwarding table; false when this
 *  (type, fn) is already live through the OTHER id-0 target — the caller
 *  remembers `null` in its own wrap map and skips the registration. */
const claimShared = (doc: InternalDocument, type: string, fn: ProxyEventHandler): boolean => {
  let seen = sharedForwarded.get(doc);
  if (seen === undefined) sharedForwarded.set(doc, (seen = new Map()));
  let fns = seen.get(type);
  if (fns === undefined) seen.set(type, (fns = new Set()));
  if (fns.has(fn)) return false;
  fns.add(fn);
  return true;
};

const releaseShared = (doc: InternalDocument, type: string, fn: ProxyEventHandler): void => {
  sharedForwarded.get(doc)?.get(type)?.delete(fn);
};

/**
 * Wrap a proxy listener with the piece upstream can't supply: `this` and
 * the enriched payload (`target`/`currentTarget`/`composedPath()`) already
 * come from islands's listener dispatch — the adapter adds a
 * `flushSync()` after the handler so the DOM patch a `$state` mutation
 * schedules lands in the dispatch return batch.
 */
const wrapListener = (fn: ProxyEventHandler): ProxyEventHandler => {
  const wrapped: ProxyEventHandler = function (this: unknown, payload): void {
    try {
      fn.call(this, payload);
    } finally {
      flushSync();
    }
  };
  return wrapped;
};

/** The addEventListener surface the patches sit on (options included —
 *  `{once, passive, capture}` ride the `listen` op's `opts` upstream). */
type ListenerTarget = {
  addEventListener(
    type: string,
    fn: ProxyEventHandler,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    fn: ProxyEventHandler,
    options?: boolean | EventListenerOptions,
  ): void;
};

/**
 * Prototype-level wrap for every proxy element: per-node orig→wrapped
 * bookkeeping, `flushSync` after each dispatch, and — for `doc.body`
 * (instance id 0) — the cross-target dedupe shared with the document
 * patch. Registration options pass through untouched.
 */
const installElementListenerPatch = (): void => {
  const proto = ProxyElement.prototype as unknown as ListenerTarget &
    Record<string, unknown>;
  const protoAdd = ProxyElement.prototype.addEventListener;
  const protoRemove = ProxyElement.prototype.removeEventListener;

  proto.addEventListener = function (
    this: ProxyElement,
    type: string,
    fn: ProxyEventHandler,
    options?: boolean | AddEventListenerOptions,
  ): void {
    let local = listenerWraps.get(this);
    if (local === undefined) listenerWraps.set(this, (local = new Map()));
    let byType = local.get(type);
    if (byType === undefined) local.set(type, (byType = new Map()));
    if (byType.has(fn)) return;
    if (this.instance.id === 0 && !claimShared(this.doc as InternalDocument, type, fn)) {
      byType.set(fn, null); // already live on the other id-0 target
      return;
    }
    const wrapped = wrapListener(fn);
    byType.set(fn, wrapped);
    protoAdd.call(this, type, wrapped, options);
  };

  proto.removeEventListener = function (
    this: ProxyElement,
    type: string,
    fn: ProxyEventHandler,
    options?: boolean | EventListenerOptions,
  ): void {
    const byType = listenerWraps.get(this)?.get(type);
    const wrapped = byType?.get(fn);
    if (wrapped === undefined) {
      // Not a svelte-wrapped listener — e.g. upstream's {once} auto-removal
      // passes the WRAPPED fn back; let the base impl decide.
      protoRemove.call(this, type, fn, options);
      return;
    }
    byType!.delete(fn);
    if (wrapped === null) return; // was deduped away — nothing to remove
    if (this.instance.id === 0) releaseShared(this.doc as InternalDocument, type, fn);
    protoRemove.call(this, type, wrapped, options);
  };
};

/**
 * Instance-level patch on the instance's proxy document — the second half of
 * the `[target, document]` dedupe (`doc.body` IS the id-0 element, so its
 * listeners take the proto patch's shared branch) plus the same
 * `flushSync` wrap for document-attached handlers.
 */
const patchDocumentListeners = (doc: InternalDocument): void => {
  const origAdd = doc.addEventListener.bind(doc);
  const origRemove = doc.removeEventListener.bind(doc);
  let local = listenerWraps.get(doc);
  if (local === undefined) listenerWraps.set(doc, (local = new Map()));
  const mutable = doc as unknown as Record<string, unknown>;

  mutable.addEventListener = (
    type: string,
    fn: ProxyEventHandler,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    let byType = local.get(type);
    if (byType === undefined) local.set(type, (byType = new Map()));
    if (byType.has(fn)) return;
    if (!claimShared(doc, type, fn)) {
      byType.set(fn, null); // already live on the other id-0 target
      return;
    }
    const wrapped = wrapListener(fn);
    byType.set(fn, wrapped);
    origAdd(type, wrapped, options);
  };

  mutable.removeEventListener = (
    type: string,
    fn: ProxyEventHandler,
    options?: boolean | EventListenerOptions,
  ): void => {
    const byType = local.get(type);
    const wrapped = byType?.get(fn);
    if (wrapped === undefined) {
      // Not a svelte-wrapped listener — e.g. upstream's {once} auto-removal
      // passes the WRAPPED fn back; let the base impl decide.
      origRemove(type, fn, options);
      return;
    }
    byType!.delete(fn);
    if (wrapped === null) return; // was deduped away — nothing to remove
    releaseShared(doc, type, fn);
    origRemove(type, wrapped, options);
  };
};

let compatInstalled = false;

/**
 * The one module-level patch Svelte still needs — listener wrapping on the
 * ProxyElement prototype (flushSync + the id-0 dedupe). Installed once per
 * module graph at the first svelteIslandApp mount; every other shim this
 * adapter used to carry (comments, cloneNode, child-node conveniences,
 * template.content, namespaced attrs, globals) is upstream now.
 */
function installSvelteCompat(): void {
  if (compatInstalled) return;
  compatInstalled = true;
  installElementListenerPatch();
}

/** Per-document decoration — just the listener patch; createComment/
 *  importNode/baseURI are real `InternalDocument` members now. */
const decorateDocument = (doc: ProxyDocument): void => {
  patchDocumentListeners(doc as InternalDocument);
};

/* ── The app wrapper ────────────────────────────────────────────────────── */

/**
 * Wrap a compiled Svelte 5 component into a `RenderedIslandApp` for
 * `definePolyWorker`/`defineMonoWorker` — usually stamped with
 * `islandApp(name, svelteIslandApp(Component))` so the shell can mount by
 * component reference.
 */
export function svelteIslandApp<P extends Record<string, unknown>>(
  Component: SvelteIslandComponent<P>,
): RenderedIslandApp {
  return {
    mount({ doc, props }: RenderContext): RenderedHandle {
      installSvelteCompat();
      decorateDocument(doc);
      const box = createPropsBox(props);
      const component = svelteMount(Component as Component<P>, {
        target: doc.body as unknown as Element,
        props: box.props as P,
        // No real timeline exists for mount transitions — skip them.
        intro: false,
      });
      return {
        // Fine-grained: the $state box invalidates only the reads that
        // changed; flushSync lands the patch inside the updateProps batch.
        update: (next: Record<string, unknown>) => {
          box.update(next);
          flushSync();
        },
        dispose: () => {
          void unmount(component);
        },
      };
    },
  };
}

/** Stamp + wrap in one step — `svelteIsland('counter', Counter)` yields the
 *  registry value AND the component-reference handle the shell can mount. */
export const svelteIsland = <P extends Record<string, unknown>>(
  name: string,
  Component: SvelteIslandComponent<P>,
): RenderedIslandApp & { readonly islandAppName: string } =>
  islandApp(name, svelteIslandApp(Component));

export interface SveltePolyWorkerRegistry {
  /** Name → Svelte component registry, mirroring `definePolyWorker({ apps })`. */
  apps: Record<string, SvelteIslandComponent>;
  /** Doorbell contract override — forwarded to `definePolyWorker`. */
  sharedMemory?: SharedMemory<DoorbellSpec>;
}

/**
 * `definePolyWorker` for Svelte apps — maps each component in the registry
 * through `svelteIslandApp` and delegates. One worker, many Svelte islands.
 */
export function defineSveltePolyWorker(
  registry: SveltePolyWorkerRegistry,
  options?: { sharedMemory?: SharedMemory<DoorbellSpec> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  const apps: Record<string, RenderedIslandApp> = {};
  for (const [name, component] of Object.entries(registry.apps)) {
    apps[name] = svelteIslandApp(component);
  }
  return definePolyWorker({
    apps,
    sharedMemory: registry.sharedMemory ?? options?.sharedMemory,
  });
}

/**
 * `defineMonoWorker` for Svelte apps — one worker pinned to a single
 * component, the isolated-bundle host shape.
 */
export function defineSvelteMonoWorker(
  component: SvelteIslandComponent,
  options?: { sharedMemory?: SharedMemory<DoorbellSpec> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  return defineMonoWorker(svelteIslandApp(component), options);
}
