/**
 * `@atolljs/angular-island/worker` — the Angular instance renderer for
 * `@atolljs/islands` islands: renders a standalone Angular
 * component into the instance's proxy document, whose mutations serialize to
 * ops the main thread replays as real DOM.
 *
 * ```ts
 * // counter.worker.ts
 * import '@angular/compiler'; // JIT facade — decorator components compile lazily
 * import { Component, input, signal } from '@angular/core';
 * import { defineMonoWorker, emit } from '@atolljs/islands/worker';
 * import { angularIslandApp } from '@atolljs/angular-island/worker';
 *
 * @Component({
 *   selector: 'atoll-counter',
 *   template: `<button (click)="inc()">{{ label() }}: {{ count() }}</button>`,
 * })
 * class CounterComponent {
 *   label = input<string>('count');
 *   count = signal(0);
 *   inc() {
 *     this.count.update((n) => n + 1);
 *     emit('incremented', { n: this.count() });
 *   }
 * }
 *
 * export const counterWorker = defineMonoWorker(angularIslandApp(CounterComponent));
 * ```
 *
 * HOW IT WORKS: `angularIslandApp` adapts the component to the
 * `RenderedIslandApp` contract — `mount(ctx)` creates a bare
 * `EnvironmentInjector` providing a `RendererFactory2` backed by `ctx.doc`
 * (the instance's proxy document), then calls Angular's public `createComponent`
 * with the instance root as `hostElement`. There is no platform, no zone, and
 * no scheduler — the same trick `platform-server` uses with Domino, but the
 * render target here is the op-emitting facade.
 *
 * CHANGE DETECTION is manual: `markViewDirty` sets flags and notifies the
 * provided `ChangeDetectionScheduler` stub — the adapter calls
 * `componentRef.changeDetectorRef.detectChanges()` + `AfterRenderManager`
 * (a) after every DOM listener invocation, so a dispatched event's
 * mutations ride back in that same task's op batch, (b) after `update()`
 * delivers props via `componentRef.setInput`, and (c) on a queued microtask
 * when the scheduler is notified from out-of-band work (timers, promise
 * continuations, view effects — run inside the instance via `runInInstance`).
 *
 * JIT: AOT-built components (a static `ɵcmp`) need nothing extra. JIT
 * (decorator metadata compiled on first use) needs `import '@angular/compiler'`
 * in the worker entry — importing it here unconditionally would bundle the
 * whole compiler into every island worker. JIT defs also cannot statically
 * see `input()`/`model()`/`output()` field initializers, so the adapter
 * wraps each reachable def's `factory` and registers the signal members it
 * discovers on instantiation — restoring `[x]`/`[(x)]` bindings, `(x)`
 * listeners, `setInput`, `ngOnChanges`, and input transforms for JIT
 * components too (see the "JIT signal-member interop" block below). One
 * caveat survives: aliases (`input({alias: 'x'})`) aren't discoverable —
 * the field name is the binding name under JIT.
 *
 * OPTIONAL FRAMEWORK SERVICES are stubbed, not left missing — several
 * public APIs inject them unconditionally and would crash with NG0201 in a
 * bare environment injector:
 * - `NgZone` → a `NoopNgZone` (there is no zone; run() runs the fn inline —
 *   honest for components that `inject(NgZone)` or run `afterRender` hooks).
 * - `ChangeDetectionScheduler` (ɵ) → a stub whose `notify()` queues a
 *   microtask `detectChanges` inside the instance's scope. This is what makes
 *   out-of-band invalidation work: a `signal.set()` in a `setTimeout`/promise
 *   continuation marks the view dirty and the queued tick renders it — ops
 *   ride the doorbell/flush like any other commit, and `emit()`s produced
 *   by that render route to this instance (the tick runs via `runInInstance`).
 *   It also unblocks `effect()` and `afterRenderEffect()`, which inject the
 *   token unconditionally.
 * - `AfterRenderManager` (ɵ, providedIn:'root') is executed after every
 *   manual `detectChanges` — the `ApplicationRef.synchronize()` step our
 *   manual tick replaces — so `afterNextRender`/`afterEveryRender`/
 *   `afterRenderEffect` sequences actually run.
 */
import {
  createComponent,
  createEnvironmentInjector,
  DOCUMENT,
  NgZone,
  Renderer2,
  RendererFactory2,
  RendererStyleFlags2,
  Sanitizer,
  ɵAfterRenderManager as AfterRenderManager,
  ɵChangeDetectionScheduler as ChangeDetectionScheduler,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
  ɵINTERNAL_APPLICATION_ERROR_HANDLER as INTERNAL_APPLICATION_ERROR_HANDLER,
  ɵNoopNgZone as NoopNgZone,
  ɵSIGNAL as SIGNAL,
  ɵgetComponentDef as getComponentDef,
  ɵgetDirectiveDef as getDirectiveDef,
  ɵinferTagNameFromDefinition as inferTagNameFromDefinition,
  reflectComponentType,
  type ComponentRef,
  type EnvironmentInjector,
  type EnvironmentProviders,
  type ListenerOptions,
  type Provider,
  type SecurityContext,
  type Type,
  type ɵNotificationSource as NotificationSource,
} from '@angular/core';
import {
  bumpOpsVersion,
  defineMonoWorker,
  definePolyWorker,
  emit,
  getActiveInstance,
  islandApp,
  islandAppNameOf,
  pushOp,
  runInInstance,
  withContract,
} from '@atolljs/islands/worker';
import type { IslandContract } from '@atolljs/islands/worker';
import type { SharedMemory, WorkerDefinition } from '@atolljs/core';
import type { IslandEvents, IslandInputs } from './index';

// Worker entries shouldn't need a second package specifier for the
// island→shell channel — `import { emit } from 'atoll-angular-island/worker'`.
export { emit, runInInstance } from '@atolljs/islands/worker';
import type {
  DoorbellSpec,
  IslandWorkerMethods,
  ProxyComment,
  ProxyDocument,
  ProxyElement,
  ProxyNode,
  ProxyText,
  RenderContext,
  RenderedHandle,
  RenderedIslandApp,
} from '@atolljs/islands/worker';

/**
 * Angular namespace tokens → URIs — the same table platform-browser's
 * NAMESPACE_URIS carries, feeding `createElementNS`/`setAttributeNS`.
 */
const NS_URIS: Record<string, string> = {
  svg: 'http://www.w3.org/2000/svg',
  math: 'http://www.w3.org/1998/Math/MathML',
  xhtml: 'http://www.w3.org/1999/xhtml',
  xlink: 'http://www.w3.org/1999/xlink',
  xml: 'http://www.w3.org/XML/1998/namespace',
  xmlns: 'http://www.w3.org/2000/xmlns/',
};

/**
 * Renderer2 over the instance's proxy document — every method is a straight
 * facade call, so each mutation emits the corresponding op
 * (create/text/append/remove/attr/style/listen/utext) automatically.
 */
class IslandRenderer extends Renderer2 {
  /**
   * Cumulative `[prop]` binding set per element — see setProperty for why
   * properties go through the `update` op channel rather than `attr`.
   */
  private readonly propSets = new WeakMap<ProxyElement, Record<string, unknown>>();

  constructor(
    private readonly doc: ProxyDocument,
    /** Run after a DOM listener returns — the manual change-detection tick. */
    private readonly afterEvent: () => void,
  ) {
    super();
  }

  readonly data: Record<string, unknown> = {};
  /**
   * Angular calls `destroyNode` per detached node when it's defined — the op
   * stream only needs the `remove` op removeChild already emitted, and the
   * instance tears listener tables down on document dispose. Null opt-out.
   */
  destroyNode: ((node: unknown) => void) | null = null;

  destroy(): void {
    // Renderer lifetime == instance lifetime; the instance disposes the document.
  }

  createElement(name: string, namespace?: string | null): ProxyElement {
    if (namespace) {
      const ns = NS_URIS[namespace] ?? namespace;
      return this.doc.createElementNS(ns, name);
    }
    return this.doc.createElement(name);
  }

  /**
   * Real comment nodes — nodeType 8 over a driver-side EMPTY text node (the
   * wire has no comment op), so container/@if/@for anchors keep
   * `before:`-addressable positions while the comment `data` stays
   * shadow-only (emitting it would render anchor text on the page).
   */
  createComment(value: string): ProxyComment {
    return this.doc.createComment(value);
  }

  createText(value: string): ProxyText {
    return this.doc.createTextNode(value);
  }

  appendChild(parent: ProxyNode, child: ProxyNode): void {
    parent.appendChild(child);
  }

  insertBefore(parent: ProxyNode, child: ProxyNode, refChild: ProxyNode | null): void {
    parent.insertBefore(child, refChild ?? null);
  }

  removeChild(_parent: unknown, child: ProxyNode): void {
    // Angular passes `parent: null` on detach (nativeRemoveNode) — the
    // shadow tree's recorded parent is authoritative; remove() emits the
    // `remove` op the driver needs.
    child.remove();
  }

  selectRootElement(selectorOrNode: unknown): ProxyElement {
    if (typeof selectorOrNode === 'string') {
      const el = this.doc.querySelector(selectorOrNode);
      if (el === null) {
        throw new Error(
          `[atoll-angular-island] host selector "${selectorOrNode}" matched nothing in the island document`,
        );
      }
      return el;
    }
    return selectorOrNode as ProxyElement;
  }

  parentNode(node: ProxyNode): ProxyNode | null {
    return node.parentNode;
  }
  nextSibling(node: ProxyNode): ProxyNode | null {
    return node.nextSibling;
  }

  /**
   * Angular passes the namespace TOKEN ('xlink', …) and the renderer
   * resolves it — same contract as DefaultDomRenderer2: the qualified name
   * is 'ns:name' and the URI comes from NS_URIS. The proxy's *AttributeNS
   * surface keys attributes by qualified name (the ns arg is advisory — the
   * wire `attr` op has no namespace field).
   */
  setAttribute(el: ProxyElement, name: string, value: string, namespace?: string | null): void {
    if (namespace) {
      const qualified = `${namespace}:${name}`;
      const uri = NS_URIS[namespace];
      if (uri !== undefined) {
        el.setAttributeNS(uri, qualified, value);
      } else {
        el.setAttribute(qualified, value);
      }
      return;
    }
    el.setAttribute(name, value);
  }
  removeAttribute(el: ProxyElement, name: string, namespace?: string | null): void {
    if (namespace) {
      const qualified = `${namespace}:${name}`;
      const uri = NS_URIS[namespace];
      if (uri !== undefined) {
        // Deviation from stock's `removeAttributeNS(uri, localName)`: the
        // proxy keys namespaced attrs by QUALIFIED name, so the qualified
        // form is what removal must address.
        el.removeAttributeNS(uri, qualified);
      } else {
        el.removeAttribute(qualified);
      }
      return;
    }
    el.removeAttribute(name);
  }
  addClass(el: ProxyElement, name: string): void {
    el.classList.add(name);
  }
  removeClass(el: ProxyElement, name: string): void {
    el.classList.remove(name);
  }

  /**
   * `DashCase` needs no special handling — the proxy style declaration
   * camelizes kebab keys itself and the driver writes camelCase onto the
   * real `el.style`. `Important` rides as the `setProperty` priority — the
   * proxy encodes it as a `!important` value suffix the driver decodes.
   */
  setStyle(el: ProxyElement, style: string, value: unknown, flags?: RendererStyleFlags2): void {
    el.style.setProperty(
      style,
      String(value),
      ((flags ?? 0) & RendererStyleFlags2.Important) !== 0 ? 'important' : undefined,
    );
  }
  removeStyle(el: ProxyElement, style: string, _flags?: RendererStyleFlags2): void {
    el.style.removeProperty(style);
  }

  /**
   * `[prop]` bindings need DOM-property semantics the stringly `attr` op
   * can't express — booleans like `checked`/`disabled`, the live `value`
   * property. The `update` op instead carries a JSON prop set the driver
   * applies with React-prop rules (`name in el` → real property write,
   * `true`/`false` → attribute + property reset), which is exactly Angular's
   * setProperty contract. The driver diffs against the LAST SENT set, so
   * every emit carries the element's cumulative property map.
   */
  setProperty(el: ProxyElement, name: string, value: unknown): void {
    let props = this.propSets.get(el);
    if (props === undefined) this.propSets.set(el, (props = {}));
    if (value === null || value === undefined || value === false) {
      delete props[name];
    } else {
      props[name] = value;
    }
    const instance = el.instance.instance;
    pushOp(instance, { t: 'update', id: el.instance.id, props: { ...props } });
    if (getActiveInstance() !== instance) bumpOpsVersion();
  }

  setValue(node: ProxyNode, value: string): void {
    node.textContent = value;
  }

  /**
   * `target` arrives RESOLVED by Angular — a ProxyElement for `(click)` etc.,
   * the proxy document for `(document:x)` (ɵɵresolveDocument → ownerDocument),
   * the doc's root element for `(body:x)`, or the window facade for
   * `(window:x)` (ɵɵresolveWindow → defaultView — undefined until mount()
   * builds the facade; the fallback keeps the listener on the island root
   * rather than crashing the view).
   * Each wrapped listener ends with a synchronous detectChanges so the
   * dispatch task's return batch carries the re-render ops.
   * `options` ({capture, once, passive} — Angular's ListenerOptions) flows
   * straight into the proxy listener: `once`/`passive`/`capture` ride the
   * `listen` op's opts field and `once` auto-detaches both sides.
   */
  listen(
    target: 'window' | 'document' | 'body' | ProxyElement,
    eventName: string,
    callback: (event: unknown) => boolean | void,
    options?: ListenerOptions,
  ): () => void {
    const wrapped = (event: unknown) => {
      try {
        return callback(event);
      } finally {
        this.afterEvent();
      }
    };
    const resolved =
      target === 'document'
        ? this.doc
        : target === 'body'
          ? this.doc.body
          : target === 'window'
            ? this.doc.defaultView
            : target;
    const listenable =
      resolved != null && typeof resolved.addEventListener === 'function'
        ? resolved
        : // No resolvable target (e.g. `(window:x)` before any defaultView) —
          // the island's document is the closest honest listener surface.
          this.doc;
    listenable.addEventListener(eventName, wrapped, options);
    return () => listenable.removeEventListener(eventName, wrapped, options);
  }
}

class IslandRendererFactory extends RendererFactory2 {
  constructor(
    private readonly doc: ProxyDocument,
    private readonly afterEvent: () => void,
  ) {
    super();
  }

  createRenderer(): Renderer2 {
    return new IslandRenderer(this.doc, this.afterEvent);
  }

  /** No animation frames in a worker — batches flush synchronously. */
  override begin(): void {}
  override end(): void {}
  override whenRenderingDone(): Promise<void> {
    return Promise.resolve();
  }
}

/* ── JIT signal-member interop ────────────────────────────────────────────
 *
 * JIT (decorator) compilation cannot see `input()`/`model()`/`output()`
 * field initializers — the resulting `def.inputs`/`def.outputs` maps only
 * list `@Input()`/`@Output()` metadata (probed: both are `{}` under JIT).
 * AOT defs carry them, so nothing here is needed for compiled output.
 *
 * Without the maps, everything downstream silently no-ops: `[x]`/`[(x)]`
 * bindings on child components fall back to DOM-property writes,
 * `(xChange)`/`(out)` listeners bind nothing, `componentRef.setInput`
 * reports "not an input", `ngOnChanges` never records, and `input({transform})`
 * never runs.
 *
 * The fix: wrap every reachable def's `factory`. Angular instantiates
 * directives via `factory(t, flags, tData, lView, tNode)` AFTER the tNode's
 * alias maps were built but BEFORE the template's property/listener
 * instructions run — so discovering signal members on the fresh instance
 * and registering them on BOTH the def (all future matches) and the live
 * tNode (this match) restores the native paths entirely:
 * `writeToDirectiveInput` (transforms + `ngOnChanges` via `def.setInput`),
 * `twoWayListener`/`listenToOutput`, `setAllInputsForProperty` (setInput).
 */

/** Mutable view of the def fields the interop patch writes. */
interface MutableDirectiveDef {
  type: Type<unknown>;
  factory?: ((...args: unknown[]) => unknown) | null;
  inputs: Record<string, unknown>;
  declaredInputs: Record<string, string>;
  outputs: Record<string, string>;
  dependencies?: unknown;
}

interface MutableTNode {
  directiveStart: number;
  directiveEnd: number;
  directiveToIndex?: Map<Type<unknown>, number | number[]>;
  inputs?: Record<string, number[]> | null;
  outputs?: Record<string, number[]> | null;
}

const jitInteropPatched = new WeakSet<object>();
/** `InputFlags.SignalBased` — the enum isn't exported from the package index. */
const INPUT_FLAG_SIGNAL_BASED = 1;

/** Index of this def's directive inside the tNode's expando range. */
function directiveIndexOn(tNode: MutableTNode, tData: unknown[] | undefined, def: MutableDirectiveDef): number {
  const viaMap = tNode.directiveToIndex?.get(def.type);
  if (typeof viaMap === 'number') return viaMap;
  if (Array.isArray(viaMap)) return viaMap[0];
  if (tData !== undefined) {
    for (let i = tNode.directiveStart; i < tNode.directiveEnd; i++) {
      if (tData[i] === def) return i;
    }
  }
  return -1;
}

/**
 * Register `publicName` → directive index on a live tNode's input/output
 * alias map — the same entries `initializeInputAndOutputAliases` would have
 * built had the def maps been complete at matching time.
 */
function linkTNodeBinding(
  tNode: MutableTNode | null | undefined,
  tData: unknown[] | undefined,
  def: MutableDirectiveDef,
  mapName: 'inputs' | 'outputs',
  publicName: string,
): void {
  if (tNode == null) return;
  const index = directiveIndexOn(tNode, tData, def);
  if (index < 0) return;
  const map = (tNode[mapName] ??= {});
  const list = (map[publicName] ??= []);
  if (!list.includes(index)) list.push(index);
}

/**
 * Scan a fresh instance for signal-member fields and register them on the
 * def + live tNode:
 * - `input()`/`input.required()`/`model()` fields are functions whose
 *   `SIGNAL` node carries `applyValueToInputSignal` (plain `signal()`,
 *   `computed()`, and `viewChild()`/`contentChild()` query signals do NOT —
 *   the check is exact).
 * - `model()` additionally exposes `.subscribe`/`.set` — its public output
 *   is `<field>Change`, bound to the field name (`def.outputs` values are
 *   private names; `instance[field]` is the subscribable ModelSignal).
 * - `output()`/`outputFromObservable()` fields are emitter objects
 *   (subscribe + emit).
 * Aliases (`input('x', {alias: 'y'})`) are not statically discoverable under
 * JIT — the field name becomes the public binding name.
 */
function patchInstanceSignalMembers(
  def: MutableDirectiveDef,
  instance: unknown,
  tNode: MutableTNode | null | undefined,
  tData: unknown[] | undefined,
): void {
  const rec = instance as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    const field = rec[key];
    const node =
      typeof field === 'function' ? (field as unknown as Record<symbol, unknown>)[SIGNAL] : undefined;
    if (
      node != null &&
      typeof (node as { applyValueToInputSignal?: unknown }).applyValueToInputSignal === 'function'
    ) {
      if (!Object.hasOwn(def.inputs, key)) {
        // The def maps are frozen (EMPTY_OBJ-style) — swap in a widened copy;
        // consumers read def.inputs/def.outputs per lookup, never cached.
        def.inputs = { ...def.inputs, [key]: [key, INPUT_FLAG_SIGNAL_BASED, null] };
        def.declaredInputs = { ...def.declaredInputs, [key]: key };
      }
      linkTNodeBinding(tNode, tData, def, 'inputs', key);
      const f = field as { subscribe?: unknown; set?: unknown };
      if (typeof f.subscribe === 'function' && typeof f.set === 'function') {
        const outName = `${key}Change`;
        if (!Object.hasOwn(def.outputs, outName)) {
          def.outputs = { ...def.outputs, [outName]: key };
        }
        linkTNodeBinding(tNode, tData, def, 'outputs', outName);
      }
      continue;
    }
    if (field != null && typeof field === 'object') {
      const f = field as { subscribe?: unknown; emit?: unknown };
      if (typeof f.subscribe === 'function' && typeof f.emit === 'function') {
        if (!Object.hasOwn(def.outputs, key)) {
          def.outputs = { ...def.outputs, [key]: key };
        }
        linkTNodeBinding(tNode, tData, def, 'outputs', key);
      }
    }
  }
}

/**
 * Wrap `def.factory` so each instantiation registers the instance's signal
 * members. `def.factory` is populated lazily by `configureViewWithDirective`
 * — assigning it eagerly makes our wrapper the one Angular stores on the
 * `NodeInjectorFactory`.
 */
function wrapDefFactoryForJitInterop(def: MutableDirectiveDef): void {
  // `def.factory` is populated lazily at first instantiation; fall back to
  // the type's own `ɵfac` (present on every decorated class — JIT classes
  // compile it on first read). NOT `ɵɵgetInheritedFactory` — that returns
  // the BASE class's factory, and `t => new t()` for base-less types.
  const original =
    def.factory ??
    ((def.type as unknown as Record<string, unknown>)['ɵfac'] as
      | ((...a: unknown[]) => unknown)
      | undefined) ??
    null;
  if (typeof original !== 'function' || (original as { __jitInterop?: boolean }).__jitInterop) return;
  const wrapped = (...args: unknown[]) => {
    const instance = original(...args);
    // Angular invokes factories as `factory(t, flags, tData, lView, tNode)`.
    patchInstanceSignalMembers(def, instance, args[4] as MutableTNode, args[2] as unknown[]);
    return instance;
  };
  (wrapped as { __jitInterop?: boolean }).__jitInterop = true;
  def.factory = wrapped;
}

/** Flatten `def.dependencies` (array or `() => [...]` thunk, entries maybe thunks). */
function dependencyTypes(def: MutableDirectiveDef): unknown[] {
  let deps = def.dependencies;
  try {
    deps = typeof deps === 'function' ? (deps as () => unknown[])() : deps;
  } catch {
    return [];
  }
  if (!Array.isArray(deps)) return [];
  const out: unknown[] = [];
  for (const d of deps) {
    if (typeof d === 'function' && (d as { prototype?: unknown }).prototype === undefined) {
      // Deferred-dependency thunk: `() => Type` (or `() => [..]`).
      try {
        const resolved = (d as () => unknown)();
        out.push(...(Array.isArray(resolved) ? resolved : [resolved]));
      } catch {
        /* unresolved lazy dep — skip */
      }
    } else if (d != null) {
      out.push(d);
    }
  }
  return out;
}

/**
 * Wrap the root component's def plus every directive/component def reachable
 * through `dependencies`, recursively — before the first `detectChanges`,
 * so a nested JIT child's factory is already wrapped when the parent's
 * first create pass instantiates it.
 */
function prepareJitSignalInterop(rootDef: MutableDirectiveDef): void {
  const pending: MutableDirectiveDef[] = [rootDef];
  while (pending.length > 0) {
    const def = pending.pop()!;
    if (jitInteropPatched.has(def)) continue;
    jitInteropPatched.add(def);
    wrapDefFactoryForJitInterop(def);
    for (const dep of dependencyTypes(def)) {
      const depDef = (getComponentDef(dep as Type<unknown>) ?? getDirectiveDef(dep as Type<unknown>)) as
        | MutableDirectiveDef
        | null;
      if (depDef != null && typeof depDef === 'object') pending.push(depDef);
    }
  }
}

/** Options accepted by {@link angularIslandApp}. */
export interface AngularIslandAppOptions<C = unknown> {
  /**
   * Extra providers merged into the island's root environment injector —
   * app-level services (`provideX()` results included) the component tree
   * injects. RendererFactory2/DOCUMENT/Sanitizer are always provided and
   * cannot be overridden from here.
   */
  providers?: Array<Provider | EnvironmentProviders>;
  /**
   * The wire contract the shell types against — typed
   * `IslandContract<IslandInputs<C>, IslandEvents<C>>` so a contract that
   * can't satisfy the component's `input()`/`output()` surface fails HERE
   * (MFE compile time), not in a consumer's build. Stamped onto the
   * returned app (`withContract`) — the worker enforces it at mount,
   * updateProps, and emit.
   */
  contract?: IslandContract<IslandInputs<C>, IslandEvents<C>>;
}

/* ── @AngularIsland — the decorator-driven registry ─────────────────────────
 *
 * Angular's component class IS its contract: `input()`/`model()`/`output()`
 * fields are typed instance members, so `IslandInputs<typeof C>` and
 * `IslandOutputs<typeof C>` (exported from the shell entry) derive the
 * island's props/events contract from the class alone. `@AngularIsland`
 * completes the facade by stamping the class with its registry name and
 * registering it — `defineAngularPolyWorker()` called with no argument then
 * collects every decorated component in the worker's module graph, so the
 * worker entry never repeats a name the decorator already declared.
 *
 *   @AngularIsland  ('counter')
 *   @Component({...})
 *   export class CounterComponent { count = input(0); }
 *
 *   // worker entry — no apps map to keep in sync:
 *   export const worker = defineAngularPolyWorker();
 */

/** Options accepted by {@link AngularIsland}. */
export interface AngularIslandDecoratorOptions extends AngularIslandAppOptions {
  /**
   * Registry name — the wire key and `islandAppNameOf` result. Defaults to
   * the kebab-cased class name minus a trailing `Component`
   * (`CounterComponent` → 'counter', `Foo` → 'foo'). The default reads
   * `.name` at runtime — minifiers mangle class names, so pass the key
   * explicitly in any build that minifies.
   */
  name?: string;
}

/** `CounterComponent` → 'counter'; `IncidentList` → 'incident-list'. */
const defaultAngularIslandName = (t: Type<unknown>): string => {
  const base = t.name.replace(/Component$/, '');
  const kebab = base
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
  return kebab !== '' ? kebab : base.toLowerCase();
};

/**
 * Name → decorated component registry. Populated by `@AngularIsland` at
 * module-eval time; consumed by `defineAngularPolyWorker()` when called
 * with no `apps` argument. One module-level map per module graph — an
 * InProcessWorker test that imports several worker entries sees them all,
 * which is fine: the entries are the same objects.
 */
const angularIslandRegistry = new Map<string, AngularIslandEntry>();

/**
 * Class decorator marking a standalone Angular component as an island app.
 * Stamps `islandAppName` (readable by the shell's `islandAppNameOf` and by
 * `app` inputs that take a `Type`) and registers the component so
 * `defineAngularPolyWorker()` can collect it without a hand-kept `apps` map.
 *
 * ```ts
 * @AngularIsland('counter')          // explicit registry key
 * @Component({ standalone: true, ... })
 * export class CounterComponent { label = input('count'); }
 *
 * @AngularIsland                    // 'notes' derived from the class name —
 * @Component({ standalone: true, ... }) // unsafe under minification
 * export class NotesComponent { ... }
 * ```
 *
 * Decorator order: place ABOVE `@Component` — it stamps and registers only;
 * it never touches the component def, so it composes with every Angular
 * decorator and works identically under JIT and AOT.
 */
export function AngularIsland(name: string): (target: Type<unknown>) => void;
export function AngularIsland(
  options: AngularIslandDecoratorOptions,
): (target: Type<unknown>) => void;
export function AngularIsland(target: Type<unknown>): void;
export function AngularIsland(
  arg?: string | AngularIslandDecoratorOptions | Type<unknown>,
): ((target: Type<unknown>) => void) | void {
  const decorate = (target: Type<unknown>, spec?: string | AngularIslandDecoratorOptions): void => {
    const name =
      (typeof spec === 'string' ? spec : spec?.name) ?? defaultAngularIslandName(target);
    islandApp(name, target);
    const entry: AngularIslandEntry =
      typeof spec === 'object' &&
        (spec?.providers !== undefined || spec?.contract !== undefined)
        ? { component: target, providers: spec.providers, contract: spec.contract }
        : target;
    angularIslandRegistry.set(name, entry);
  };
  // Bare-decorator form: `@AngularIsland` used without parens passes the class.
  if (typeof arg === 'function' && arg.prototype !== undefined) {
    decorate(arg);
    return;
  }
  return (target) => decorate(target, arg as string | AngularIslandDecoratorOptions | undefined);
}

/** Read the registered (or stamped-but-unregistered) name of a component —
 *  what the shell must pass as `app`. Stamp first, then the same kebab
 *  default the decorator/array forms apply (`CounterComponent` → 'counter'). */
export const angularIslandNameOf = (component: Type<unknown> | string): string | undefined => {
  if (typeof component === 'string') return component === '' ? undefined : component;
  const stamped = (component as unknown as { islandAppName?: string }).islandAppName;
  if (typeof stamped === 'string' && stamped !== '') return stamped;
  if (typeof component === 'function') return defaultAngularIslandName(component);
  return islandAppNameOf(component);
};

/**
 * Wrap a standalone Angular component as a `RenderedIslandApp` — usable as a
 * `defineMonoWorker`/`definePolyWorker` app alongside React and imperative
 * entries.
 *
 * mount semantics:
 * - The component's template renders inside a host element carrying the
 *   component's selector tag (`<atoll-counter>`), itself appended to the
 *   island root — the structure a browser bootstrap produces.
 * - `update(props)` calls `componentRef.setInput(name, value)` for each key
 *   matching a declared input — AOT `@Input` names AND JIT `input()`/
 *   `model()` fields, which the interop pass registers into the def's
 *   input map under their field name — then one synchronous `detectChanges`.
 *   Keys still unmatched fall back to a direct signal-node write (covers
 *   exotic cases the interop scan missed); props that match nothing are
 *   dropped (warned once per name) — inputs are the honest Angular contract.
 * - `dispose()` destroys the component ref (running destroys/unlistens) and
 *   the environment injector before the instance's document dies.
 */
export function angularIslandApp<C>(
  component: Type<C>,
  options?: AngularIslandAppOptions<C>,
): RenderedIslandApp {
  const app: RenderedIslandApp = {
    renderer: 'angular',
    mount(ctx: RenderContext): RenderedHandle {
      // `createComponent` resolves the component def — for a JIT (decorator)
      // component that getter hits the compiler facade; surface the fix when
      // '@angular/compiler' was never imported.
      let componentDef;
      try {
        componentDef = getComponentDef(component);
      } catch (err) {
        throw new Error(
          `[atoll-angular-island] ${component.name} needs the JIT compiler — ` +
            `add \`import '@angular/compiler';\` to the worker entry ` +
            `(${err instanceof Error ? err.message.split('\n')[0] : String(err)})`,
        );
      }
      if (componentDef === null) {
        throw new Error(`[atoll-angular-island] ${component.name} is not an Angular component`);
      }

      let componentRef: ComponentRef<unknown> | null = null;
      let ticking = false;
      let tickQueued = false;
      // Manual CD: no zone — a listener's mutations must be rendered inside
      // the dispatch that delivered it, so each event ends with a synchronous
      // detectChanges on the root view, then the AfterRenderManager pass an
      // ApplicationRef.synchronize() would run (afterNextRender/
      // afterEveryRender/afterRenderEffect sequences live there).
      const detectChanges = (): void => {
        ticking = true;
        try {
          componentRef?.changeDetectorRef.detectChanges();
          environmentInjector.get(AfterRenderManager).execute();
        } finally {
          ticking = false;
        }
      };
      const rendererFactory = new IslandRendererFactory(ctx.doc, detectChanges);

      // markViewDirty reaches the LView's environment injector for a
      // ChangeDetectionScheduler — provide one so signal writes outside a
      // dispatch (timers, promise continuations, effect()/afterRenderEffect
      // which inject the token unconditionally) still get rendered: notify()
      // queues ONE microtask tick inside the instance's scope, so the render's
      // ops route to this instance's queue (emit() included) instead of the
      // ambient '' queue.
      const changeDetectionScheduler: ChangeDetectionScheduler = {
        get runningTick() {
          return ticking;
        },
        notify(_source: NotificationSource): void {
          if (tickQueued) return;
          tickQueued = true;
          queueMicrotask(() => {
            tickQueued = false;
            if (componentRef === null || ticking) return;
            runInInstance(ctx.instance, detectChanges);
            // The tick ran under the instance, so instance-bound ops queued
            // WITHOUT ringing the doorbell — ring it once here so push-mode
            // drivers flush this out-of-task commit instead of waiting on a
            // poll or the next dispatch.
            bumpOpsVersion();
          });
        },
      };

      const environmentInjector = createEnvironmentInjector(
        [
          // Environment injectors default to scope 'environment' only —
          // `providedIn: 'root'` services (SharedStore-style app services AND
          // Angular's own AfterRenderManager/LOCALE_ID/PendingTasks) would
          // NG0201. Declaring the scope 'root' puts the same services in
          // scope as a real app-root injector.
          { provide: INJECTOR_SCOPE, useValue: 'root' },
          { provide: RendererFactory2, useValue: rendererFactory },
          { provide: DOCUMENT, useValue: ctx.doc },
          // There is no zone in an island worker — a NoopNgZone gives
          // inject(NgZone)/AfterRenderImpl real objects with inline-run
          // semantics instead of NG0201.
          { provide: NgZone, useValue: new NoopNgZone() },
          { provide: ChangeDetectionScheduler, useValue: changeDetectionScheduler },
          {
            provide: Sanitizer,
            useValue: {
              sanitize: (_ctx: SecurityContext, value: unknown) => value,
            },
          },
          // Listener/render errors have no ApplicationRef to surface to —
          // without this token they're silently swallowed.
          {
            provide: INTERNAL_APPLICATION_ERROR_HANDLER,
            useValue: (err: unknown) => console.error('[atoll-angular-island]', err),
          },
          ...(options?.providers ?? []),
        ],
        null as unknown as EnvironmentInjector,
      );

      // Build the document's window facade so `doc.defaultView` resolves —
      // Angular reads it via ɵɵresolveWindow for `(window:x)` listeners and
      // component code can reach `window`/timers through it. Reading the
      // dispatcher's `window` global inside the instance's scope (mount() is
      // always called under runInInstance) caches the facade ON this document
      // without claiming ambient globals the way installDomShim does — so
      // sibling mounts in a shared worker keep their own facades.
      void (globalThis as { window?: unknown }).window;

      // The component's own selector tag is its host element — what a real
      // bootstrap produces (`<atoll-counter>` inside the island container).
      const host = ctx.doc.createElement(inferTagNameFromDefinition(componentDef));
      ctx.doc.body.appendChild(host);
      // JIT signal-member interop — wraps this def's factory and every
      // def reachable through `dependencies` (the whole template's
      // component/directive set), so nested JIT `input()`/`model()`/`output()`
      // fields bind like AOT-declared ones. No-op for AOT defs.
      prepareJitSignalInterop(componentDef as MutableDirectiveDef);
      componentRef = createComponent(component, {
        environmentInjector,
        hostElement: host as unknown as Element,
      });
      // Root belt-and-suspenders: if the instantiation path skipped our
      // factory wrap, register this instance's signal members against its
      // live host tNode (`_tNode` is internal but stable across v17–v22).
      patchInstanceSignalMembers(
        componentDef as MutableDirectiveDef,
        componentRef.instance,
        (componentRef as unknown as { _tNode?: MutableTNode })._tNode,
        undefined,
      );

      // Input template names (`[alias]` included) — the only props keys that
      // can be delivered. reflectComponentType reuses the resolved def.
      const inputs = new Set(
        (reflectComponentType(component)?.inputs ?? []).map((i) => i.templateName),
      );
      const warned = new Set<string>();
      const setProps = (props: Record<string, unknown>): void => {
        for (const [name, value] of Object.entries(props)) {
          if (inputs.has(name)) {
            componentRef!.setInput(name, value);
            continue;
          }
          // Safety net: a prop not in the def's input map may still be an
          // `input()`/`model()` field the interop scan didn't register
          // (e.g. non-enumerable or setter-shaped members). A signal-input
          // field is writable through its `SIGNAL` node's
          // `applyValueToInputSignal` (present only on InputSignalNode —
          // plain `signal()` fields lack it). This direct write skips
          // ngOnChanges/transforms, so it stays the fallback, not the path.
          const field = (componentRef!.instance as Record<string, unknown>)[name];
          const node = (typeof field === 'function'
            ? (field as unknown as Record<symbol, unknown>)[SIGNAL]
            : null) as { applyValueToInputSignal?: (node: unknown, v: unknown) => void } | undefined;
          if (node && typeof node.applyValueToInputSignal === 'function') {
            node.applyValueToInputSignal(node, value);
            continue;
          }
          if (!warned.has(name)) {
            warned.add(name);
            console.warn(
              `[atoll-angular-island] prop "${name}" is not a declared input of ${component.name} — dropped`,
            );
          }
        }
      };
      // Deliver the mount props — setInput marks the view dirty; one tick
      // renders them (the createComponent render already ran with defaults).
      setProps(ctx.props);
      detectChanges();

      // Root-component outputs have no template host to bind to inside an
      // island — bridge them onto the `emit` channel so the component's
      // declared output surface IS the island's event contract:
      // `saved = output<T>()` produces island events named 'saved';
      // `x = model<T>()` produces 'xChange' events (the same public name
      // Angular gives the two-way-binding output). Emissions can land while
      // no task holds the instance (async producers) — re-enter the
      // instance so the op lands on this island's queue, not the ambient
      // one, and bump the version so push-mode drivers flush it.
      const outputSubscriptions: Array<{ unsubscribe(): void }> = [];
      for (const [publicName, privateName] of Object.entries(componentDef.outputs)) {
        const member = (componentRef.instance as Record<string, unknown>)[privateName];
        const sub =
          member != null && typeof (member as { subscribe?: unknown }).subscribe === 'function'
            ? (member as { subscribe: (fn: (v: unknown) => void) => { unsubscribe(): void } })
                .subscribe((value: unknown) => {
                  runInInstance(ctx.instance, () => emit(publicName, value));
                  bumpOpsVersion();
                })
            : null;
        if (sub !== null) outputSubscriptions.push(sub);
      }

      return {
        update(props: Record<string, unknown>): void {
          setProps(props);
          detectChanges();
        },
        dispose(): void {
          const ref = componentRef;
          componentRef = null;
          for (const sub of outputSubscriptions.splice(0)) sub.unsubscribe();
          ref?.destroy();
          environmentInjector.destroy();
        },
      };
    },
  };
  // Contract stamp — the worker engine reads it at mount/updateProps/emit.
  return options?.contract !== undefined ? withContract(options.contract, app) : app;
}

/** Stamp + wrap in one step — `angularIsland('counter', CounterComponent)`
 *  yields the registry value AND the component-reference handle the shell
 *  can mount. */
export const angularIsland = <C>(
  name: string,
  component: Type<C>,
  options?: AngularIslandAppOptions<C>,
): RenderedIslandApp & { readonly islandAppName: string } =>
  islandApp(name, angularIslandApp(component, options));

/** A registry entry: the component, or `{ component, providers }` when the
 *  app needs injector extras (`angularIslandApp`'s options). */
export type AngularIslandEntry = Type<unknown> | ({ component: Type<unknown> } & AngularIslandAppOptions);

export interface AngularPolyWorkerRegistry {
  /**
   * Name → component registry — or just the components: an ARRAY resolves
   * each entry's name from its `islandAppName` stamp (`@AngularIsland`) or,
   * failing that, the class's kebab-cased name (`CounterComponent` →
   * 'counter'). Omit `apps` entirely to mount every `@AngularIsland`
   * component imported into the worker's module graph.
   */
  apps?: Record<string, AngularIslandEntry> | readonly AngularIslandEntry[];
  /** Doorbell contract override — forwarded to `definePolyWorker`. */
  sharedMemory?: SharedMemory<DoorbellSpec>;
}

/**
 * Resolve an `apps` argument into a name→entry map. Record form passes
 * through verbatim; array form names each entry by `islandAppNameOf`
 * (the stamp `@AngularIsland` writes) falling back to the kebab-cased
 * class name.
 */
function resolveAngularApps(
  apps: AngularPolyWorkerRegistry['apps'],
): Record<string, AngularIslandEntry> {
  if (apps === undefined) {
    // No explicit registry — every @AngularIsland component imported so far.
    return Object.fromEntries(angularIslandRegistry);
  }
  if (!Array.isArray(apps)) return { ...(apps as Record<string, AngularIslandEntry>) };
  const out: Record<string, AngularIslandEntry> = {};
  for (const entry of apps) {
    const component = typeof entry === 'function' ? entry : entry.component;
    // Stamp first (decorator/`islandApp`), then the same kebab default the
    // decorator uses — NOT islandAppNameOf's raw-function-name fallback,
    // which would register 'CounterComponent' while the shell resolves
    // the same class to 'counter'.
    const name =
      (component as unknown as { islandAppName?: string }).islandAppName ??
      defaultAngularIslandName(component);
    out[name] = entry;
  }
  return out;
}

/**
 * `definePolyWorker` for Angular apps — maps each component in the
 * registry through `angularIslandApp` and delegates. One worker, many
 * Angular islands. Three call shapes:
 *
 * ```ts
 * defineAngularPolyWorker({ apps: { counter: Counter, notes: Notes } }); // explicit
 * defineAngularPolyWorker({ apps: [Counter, Notes] });                  // named by stamp/class
 * defineAngularPolyWorker();                                          // every @AngularIsland
 * ```
 *
 * Per-app injector extras pass through the `{ component, providers }`
 * entry form.
 */
export function defineAngularPolyWorker(
  registry: AngularPolyWorkerRegistry | readonly AngularIslandEntry[] = {},
  options?: { sharedMemory?: SharedMemory<DoorbellSpec> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  const reg: AngularPolyWorkerRegistry = Array.isArray(registry)
    ? { apps: registry as readonly AngularIslandEntry[] }
    : (registry as AngularPolyWorkerRegistry);
  const apps: Record<string, RenderedIslandApp> = {};
  for (const [key, entry] of Object.entries(resolveAngularApps(reg.apps))) {
    apps[key] =
      typeof entry === 'function'
        ? angularIslandApp(entry)
        : angularIslandApp(entry.component, entry);
  }
  return definePolyWorker({
    apps,
    sharedMemory: reg.sharedMemory ?? options?.sharedMemory,
  });
}

/**
 * `defineMonoWorker` for Angular apps — one worker pinned to a single
 * component, the isolated-bundle host shape. Injector extras pass through
 * `AngularIslandAppOptions`.
 */
export function defineAngularMonoWorker<C>(
  component: Type<C>,
  options?: AngularIslandAppOptions<C> & { sharedMemory?: SharedMemory<DoorbellSpec> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  const { sharedMemory, ...appOptions } = options ?? {};
  return defineMonoWorker(angularIslandApp(component, appOptions), { sharedMemory });
}
