/**
 * `@atolljs/angular-island` — the Angular shell surface for
 * `@atolljs/islands` islands: a worker-hosted Angular (or React, or
 * imperative proxy-DOM) tree mounted as an ordinary element in a
 * main-thread Angular app.
 *
 * ```ts
 * import { Component } from '@angular/core';
 * import { AtollIslandComponent, islandComponent } from '@atolljs/angular-island';
 * import type { CounterComponent } from './counter.component'; // type-only!
 *
 * // The facade — a standalone component whose [props] is typed from the
 * // worker component's own input() fields:
 * const CounterIsland = islandComponent<CounterComponent>({
 *   app: 'counter',
 *   worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
 * });
 *
 * @Component({
 *   standalone: true,
 *   imports: [CounterIsland],
 *   template: `<counter-island [props]="{ label: 'alpha' }" />`,
 * })
 * export class DashboardComponent {}
 * ```
 *
 * Semantics (mirroring `@atolljs/react-island`):
 * - Mounting is async — `ngOnInit` hands the host element to `mountIsland`,
 *   which spawns the worker and replays the first op batch. `onReady`
 *   receives the `IslandHandle` once mounted; failures go to `onError`
 *   (or `console.error` when no `onError` is bound).
 * - `props` input changes call `island.updateProps` — deduped by
 *   JSON-serialized identity, so change detection re-delivering an equal
 *   props object costs no round-trip (props cross the wire serialized
 *   anyway, making that the honest equality).
 * - `onEvent`/`onActivity`/`onReady`/`onError`/`slots` are read at call time
 *   — rebinding fresh closures never remounts the worker.
 * - `app`/`client`/`worker` changes remount the island (destroy + fresh
 *   mount); `ngOnDestroy` destroys the island — the worker terminates
 *   unless the client is SHARED (several islands on one client mount
 *   mounts into one worker; the instance unmounts and the worker dies
 *   with the last island to leave).
 *
 * `AtollIslandDirective` (`[atollIsland]`) carries the same inputs and can be
 * applied to ANY host element (`<div atollIsland [worker]="…"/>`);
 * `AtollIslandComponent` (`<atoll-island>`) is the same behavior with the
 * dedicated element selector — both inherit from a shared base so their
 * input surface and lifecycle are identical.
 *
 * INFERENCE: `AtollIslandComponent<C>` and the `islandComponent` facade type
 * `props` from the worker component class — every field assignable to
 * `InputSignalWithTransform<unknown, W>` contributes `W` to the props
 * contract, so `input<T>()`, `input.required<T>()`, and `model<T>()` fields
 * are all visible. The component type can come from `import type` — the
 * facade needs only the registry name (or the class itself, stamped by
 * `@AngularIsland`/`islandApp`) at runtime.
 */
import {
  Component,
  Directive,
  ElementRef,
  Input,
  NgModule,
  inject,
  ɵɵInheritDefinitionFeature,
  ɵɵNgOnChangesFeature,
  ɵɵdefineComponent,
} from '@angular/core';
import type {
  InputSignalWithTransform,
  ModelSignal,
  OnChanges,
  OnDestroy,
  OnInit,
  OutputEmitterRef,
  SimpleChanges,
  Type,
} from '@angular/core';
import { contractWorkerOf, islandAppNameOf, mountIsland } from '@atolljs/islands';
import type {
  IslandAppLike,
  IslandClient,
  IslandContract,
  IslandContractEvents,
  IslandContractProps,
  IslandHandle,
  IslandWorkerOptions,
  Mode,
} from '@atolljs/islands';

// Re-export the handle types consumers need to name — same courtesy as the
// React binding, so a second package import is never required.
export type { IslandClient, IslandHandle };

/* ── Inference: the component class IS the contract ─────────────────────── */

/**
 * The props a worker component accepts — derived from its signal-input
 * fields. `input<T>()`/`input.required<T>()`/`model<T>()` fields all carry
 * `InputSignalWithTransform<unknown, W>` (W is the WRITE type, honoring
 * transforms). Plain `@Input()`-decorated fields aren't type-distinguishable
 * from ordinary fields, so the signal-input APIs are the typed contract —
 * matching the adapter's runtime rule that island props land via
 * `componentRef.setInput`.
 */
export type IslandInputs<C> = {
  [K in keyof C as C[K] extends InputSignalWithTransform<unknown, infer _W>
    ? K
    : never]?: C[K] extends InputSignalWithTransform<unknown, infer W> ? W : never;
};

/**
 * The events a worker component can emit — its `output<T>()` fields
 * (`OutputEmitterRef<T>` → event `K` with payload `T`) plus `model<T>()`
 * fields (`xChange` with payload `T`). The worker adapter bridges every
 * declared output onto the island's `emit` channel, so this is the exact
 * `onEvent` vocabulary — pairs with `IslandEventsHandler<C>`.
 */
export type IslandEvents<C> = {
  [K in keyof C as C[K] extends OutputEmitterRef<infer _>
    ? K
    : C[K] extends ModelSignal<infer _>
      ? `${K & string}Change`
      : never]: C[K] extends OutputEmitterRef<infer T>
    ? T
    : C[K] extends ModelSignal<infer T>
      ? T
      : never;
};

/** The `onEvent` signature for a component class — `(name, payload)` with
 *  payload narrowed per event name. */
export type IslandEventHandler<C> = <K extends keyof IslandEvents<C> & string>(
  name: K,
  payload: IslandEvents<C>[K],
) => void;

/**
 * The component type a reference carries: `Type<T>` (a class) or an
 * already-wrapped island app (imperative def / `{ mount }`). Plain string
 * registry names stay on the untyped path.
 */
export type IslandAppRef<C> = Type<C> | IslandAppLike | string;

/**
 * The phantom "component class" a `defineIslandContract` poses as — its prop
 * keys pose as `InputSignalWithTransform` fields (so `IslandInputs<…>` yields
 * the contract's `P`) and its event names as `OutputEmitterRef`s (so
 * `IslandEvents<…>` yields the contract's `E`). Feeds the class-generic
 * facade without the shell ever importing a real component — the
 * cross-framework path.
 */
export type IslandContractCarrier<C extends IslandContract> = {
  [K in keyof IslandContractProps<C>]: InputSignalWithTransform<
    IslandContractProps<C>[K],
    IslandContractProps<C>[K]
  >;
} & {
  [K in keyof IslandContractEvents<C> & string]: OutputEmitterRef<
    IslandContractEvents<C>[K]
  >;
};

/**
 * Resolve an `app` input to its wire name — mirrors the worker side's
 * convention: stamps win (`@AngularIsland`/`islandApp`), then a class's
 * kebab-cased name minus `Component` (`CounterComponent` → 'counter'),
 * then `islandAppNameOf`'s general fallbacks (displayName, imperative def).
 * Class-name fallbacks read `.name` at runtime — under minification pass a
 * string or a stamped class, not an unstamped class reference.
 */
const resolveAppName = (app: IslandAppRef<unknown> | undefined): string | undefined => {
  if (app === undefined || app === null) return undefined;
  if (typeof app === 'string') return app === '' ? undefined : app;
  const stamped = (app as { islandAppName?: unknown }).islandAppName;
  if (typeof stamped === 'string' && stamped !== '') return stamped;
  if (typeof app === 'function') {
    const name = (app as { displayName?: string; name?: string }).displayName ??
      (app as { name?: string }).name;
    if (typeof name === 'string' && name !== '') {
      const base = name.replace(/Component$/, '');
      const kebab = base
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase();
      return kebab !== '' ? kebab : name;
    }
    return undefined;
  }
  return islandAppNameOf(app);
};

/** Shared island-mounting behavior for `<atoll-island>`, `[atollIsland]`,
 *  and generated `islandComponent` facades.
 *
 *  Declared as a bare `@Directive()` (no selector) so Angular treats it as a
 *  directive base class: its `@Input()` members and lifecycle hooks are
 *  inherited by subclasses, which supply only a selector. `C` is the WORKER
 *  component's instance type — it feeds `IslandInputs<C>` for `props` and
 *  narrows the `app` input to the class reference (or a stamped/wrapped
 *  app, or a registry string). */
@Directive()
export abstract class AtollIslandBase<C = unknown> implements OnInit, OnChanges, OnDestroy {
  /**
   * How to reach the worker, shared-client form — a pre-connected
   * `IslandClient` from `connectIslandWorker({ worker })`. Share one across
   * several islands to put them in ONE worker (each gets its own `app@N`
   * instance inside it). Either `client` or `worker` is required.
   */
  @Input() client?: IslandClient;
  /**
   * How to reach the worker, 1:1 form — `() => new Worker(...)` or a URL.
   * The client is island-internal and dies with `ngOnDestroy`. Ignored when
   * `client` is also set.
   */
  @Input() worker?: (() => Worker) | URL;
  /** Extra pool options for the `worker` path — see ConnectIslandWorkerConfig. */
  @Input() workerOptions?: IslandWorkerOptions & { doorbell?: boolean };
  /**
   * Initial flush mode — 'push' (default) subscribes the shared-memory
   * doorbell once mounted (needs COOP/COEP cross-origin isolation);
   * 'poll' drains committed ops on a 50ms interval and, with the `worker`
   * shorthand, builds the client doorbell-free — no SharedArrayBuffer, no
   * header requirement. Switch later via the handle's `setMode`.
   */
  @Input() mode?: Mode;
  /**
   * Which app to mount: a registry name, the component class itself
   * (name resolved from its `@AngularIsland`/`islandApp` stamp, else the
   * kebab-cased class name), or an imperative `{ imperative }`/`{ mount }`
   * definition. Optional against a instance worker (`defineMonoWorker`),
   * which resolves its single app regardless.
   */
  @Input() app?: IslandAppRef<C>;
  /**
   * Initial + updated root props — serialized to the worker. Typed as
   * `IslandInputs<C>`: the worker component's `input()`/`model()` field
   * names and write-types, all optional (Angular fills unset inputs with
   * their declared defaults).
   */
  @Input() props?: IslandInputs<C>;
  /**
   * Transclusion slots — a worker `<div data-atoll-slot="name">` hands its
   * real element to `slots[name](el)` so the shell can mount main-thread
   * content inside it. Called again with `null` on teardown.
   */
  @Input() slots?: Record<string, (el: HTMLElement | null) => void>;
  /**
   * Island → shell channel: every `emit` op lands here — including bridged
   * root-component outputs, so `(name, payload)` covers the component's
   * `output()`/`model()` surface exactly (see `IslandEvents<C>`).
   */
  @Input() onEvent?: IslandEventHandler<C> | ((name: string, payload: unknown) => void);
  /** Fired after each applied op batch — stats hooks. */
  @Input() onActivity?: () => void;
  /** The mounted handle (pid, updateProps, flush, setMode…) once ready. */
  @Input() onReady?: (handle: IslandHandle) => void;
  /** Mount/update errors surface here instead of an unhandled rejection. */
  @Input() onError?: (err: unknown) => void;

  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  private island: IslandHandle | null = null;
  /** Invalidates in-flight mounts — bump on remount/destroy. */
  private mountSeq = 0;
  /** Wire identity of the last props actually sent — the dedupe key. */
  private sentPropsJson = '';

  /**
   * Slot callbacks are looked up at op-application time through this
   * delegate, so a rebound `slots` input takes effect without remounting —
   * the same trick the React binding uses for its portal proxy.
   */
  private readonly slotDelegate = new Proxy(
    {} as Record<string, (el: HTMLElement | null) => void>,
    {
      get: (_target, name: string) => (el: HTMLElement | null) =>
        this.slots?.[name]?.(el),
    },
  );

  ngOnInit(): void {
    this.mount();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // ngOnChanges runs before ngOnInit for the initial bindings — there is
    // no island yet; the pending mount reads the current inputs directly.
    if (this.island === null && this.mountSeq === 0) return;
    if (
      'app' in changes ||
      'client' in changes ||
      'worker' in changes ||
      'workerOptions' in changes
    ) {
      // A different app or worker connection is a different island.
      this.island?.destroy();
      this.island = null;
      this.mount();
      return;
    }
    if ('props' in changes) this.pushProps();
    // Mode is mount-initial, but the handle exposes setMode — a rebound
    // [mode] switches the live island rather than remounting.
    if ('mode' in changes && this.island !== null && this.mode !== undefined) {
      this.island.setMode(this.mode);
    }
  }

  ngOnDestroy(): void {
    this.mountSeq++; // a late-resolving mount destroys itself instead
    const island = this.island;
    this.island = null;
    island?.destroy();
  }

  private mount(): void {
    const seq = ++this.mountSeq;
    const el = this.host.nativeElement;
    const client = this.client;
    // A contract `app` can carry its own worker factory — the contract
    // module is then the whole connection, templates bind no worker.
    const worker = this.worker ?? contractWorkerOf(this.app);
    if ((client === undefined || client === null) && worker === undefined) {
      this.report(
        new Error(
          '[atollIsland] requires a `client` or `worker` input — see connectIslandWorker / the worker shorthand',
        ),
      );
      return;
    }
    const app = resolveAppName(this.app);
    const propsJson = JSON.stringify(this.props ?? {});
    void (async () => {
      try {
        const mountBase = {
          el,
          app,
          props: (this.props ?? {}) as Record<string, unknown>,
          mode: this.mode,
          onEvent: (name: string, payload: unknown) =>
            // The union admits narrow per-event handlers — invoke through
            // the wide member (the wire may carry names outside C's map).
            (this.onEvent as ((n: string, p: unknown) => void) | undefined)?.(name, payload),
          onActivity: () => this.onActivity?.(),
          slots: this.slotDelegate,
        };
        const handle = await mountIsland(
          client != null
            ? { ...mountBase, client }
            : { ...(this.workerOptions ?? {}), ...mountBase, worker: worker! },
        );
        if (seq !== this.mountSeq) {
          // Destroyed/remounted while the worker was still mounting.
          handle.destroy();
          return;
        }
        this.island = handle;
        this.sentPropsJson = propsJson;
        this.onReady?.(handle);
        // `props` may have changed while the mount was in flight — pushProps
        // dedupes, so this is a no-op unless it did.
        this.pushProps();
      } catch (err) {
        if (seq === this.mountSeq) this.report(err);
      }
    })();
  }

  private pushProps(): void {
    const json = JSON.stringify(this.props ?? {});
    if (json === this.sentPropsJson) return;
    this.sentPropsJson = json;
    this.island?.updateProps((this.props ?? {}) as Record<string, unknown>).catch((err) => {
      if (this.onError !== undefined) this.onError(err);
      else console.error('[atollIsland] updateProps failed:', err);
    });
  }

  private report(err: unknown): void {
    if (this.onError !== undefined) this.onError(err);
    else console.error('[atollIsland] mount failed:', err);
  }
}

/**
 * `<atoll-island [client]="…" app="charts" [props]="…"/>` — a worker island as
 * a standalone element. All inputs are inherited from {@link AtollIslandBase}.
 *
 * For inference, either annotate the generic (`AtollIslandComponent<CounterComponent>`
 * via `imports` + `import type`) or — the preferred facade — use
 * {@link islandComponent}, which generates a dedicated host component typed
 * against the worker component class.
 */
@Component({
  selector: 'atoll-island',
  standalone: true,
  // No template — the island owns the host element's contents; Angular
  // projects nothing into it.
  template: '',
})
export class AtollIslandComponent<C = unknown> extends AtollIslandBase<C> {}

/**
 * `<div atollIsland [worker]="…" [props]="…"/>` — the same island lifecycle as
 * an attribute directive, for hosts that need their own tag/attributes.
 */
@Directive({
  selector: '[atollIsland]',
  standalone: true,
})
export class AtollIslandDirective<C = unknown> extends AtollIslandBase<C> {}

/* ── islandComponent — the facade ───────────────────────────────────────── */

/** Config for {@link islandComponent} — the mount-stable half of the
 *  island contract, baked into the generated component's defaults. */
export interface IslandComponentConfig<C = unknown> {
  /**
   * Which app to mount — a registry name, or the component class itself
   * (requires the class be stamped by `@AngularIsland`/`islandApp`, or its
   * kebab-cased name must be the registry key). Omit only for instance
   * workers (`defineAngularMonoWorker`), which resolve their single app.
   */
  app?: string | Type<C> | IslandAppLike;
  /**
   * A `defineIslandContract` — supplies the registry key (`contract.app`)
   * and, through the contract overload of {@link islandComponent}, the
   * props/event types. Pass INSTEAD of `app` for the cross-framework facade
   * — the shell imports the contract, never the component class.
   */
  contract?: IslandContract;
  /**
   * Custom-element selector for the generated component — e.g.
   * `'counter-island'` produces `<counter-island>`. Defaults to
   * `'atoll-island'` when omitted (fine for `NgComponentOutlet`-style use,
   * or when only one facade is imported into a template).
   */
  selector?: string;
  /**
   * Baked-in worker connection — `worker` factory/URL or a shared `client`
   * (plus `workerOptions`/`mode`). An element may still override per-mount
   * by binding `[client]`/`[worker]`, but the defaults make the common
   * `<counter-island [props]="…"/>` call site zero-config.
   */
  worker?: (() => Worker) | URL;
  client?: IslandClient;
  workerOptions?: IslandWorkerOptions & { doorbell?: boolean };
  mode?: Mode;
}

/**
 * `islandComponent<C>({ app: 'counter', worker })` — the React
 * `islandComponent`/`lazyIsland` analog: a generated standalone component
 * whose `props` input is typed from the WORKER component's `input()`/
 * `model()` fields (`IslandInputs<C>`).
 *
 * ```ts
 * import type { CounterComponent } from './counter.component';
 * const CounterIsland = islandComponent<CounterComponent>({
 *   app: 'counter',
 *   worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
 *   selector: 'counter-island',
 * });
 * // <counter-island [props]="{ label: 'alpha' }"/> — wrong keys/types error
 * // at compile time; nothing worker-side reaches the shell bundle.
 * ```
 *
 * The generated class carries a hand-authored `ɵcmp` (`ɵɵdefineComponent`
 * + `ɵɵInheritDefinitionFeature`), so it resolves under BOTH AOT and JIT —
 * the facade never forces `import '@angular/compiler'` onto the shell.
 * All {@link AtollIslandBase} inputs remain bound (the config supplies
 * defaults, not locks).
 */
export function islandComponent<C extends IslandContract>(
  config: Omit<IslandComponentConfig<IslandContractCarrier<C>>, 'app'> & { contract: C },
): Type<AtollIslandComponent<IslandContractCarrier<C>>>;
export function islandComponent<C = unknown>(
  config: IslandComponentConfig<C>,
): Type<AtollIslandComponent<C>>;
export function islandComponent<C = unknown>(
  config: IslandComponentConfig<C>,
): Type<AtollIslandComponent<C>> {
  const selector = config.selector ?? 'atoll-island';
  class IslandFacadeComponent extends AtollIslandBase<C> {
    constructor() {
      super();
      // Config supplies DEFAULTS — explicit template bindings still win
      // (inputs are written after construction).
      if (config.app !== undefined) this.app = config.app;
      // A contract IS the app reference (resolves to contract.app via
      // islandAppNameOf); it wins when both fields are set.
      if (config.contract !== undefined) this.app = config.contract;
      if (config.client !== undefined) this.client = config.client;
      if (config.worker !== undefined) this.worker = config.worker;
      if (config.workerOptions !== undefined) this.workerOptions = config.workerOptions;
      if (config.mode !== undefined) this.mode = config.mode;
    }
  }
  // AOT-safe component def: ɵɵdefineComponent is the same call ngtsc emits —
  // no decorator metadata, no JIT compiler required on the shell. The base's
  // lazy-JIT `ɵfac`/`ɵcmp` accessors live on the static prototype chain, so
  // these must be OWN properties (defineProperty) — a plain assignment hits
  // the inherited getter-only accessor and throws.
  Object.defineProperty(IslandFacadeComponent, 'ɵfac', {
    value: (t?: Type<AtollIslandComponent<C>>) =>
      new (t ?? (IslandFacadeComponent as unknown as Type<AtollIslandComponent<C>>))(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(IslandFacadeComponent, 'ɵcmp', {
    value: ɵɵdefineComponent({
      type: IslandFacadeComponent as unknown as Type<AtollIslandComponent<C>>,
      selectors: [[selector]],
      standalone: true,
      features: [ɵɵInheritDefinitionFeature, ɵɵNgOnChangesFeature],
      decls: 0,
      vars: 0,
      template: () => {},
    }),
    configurable: true,
    writable: true,
  });
  return IslandFacadeComponent as unknown as Type<AtollIslandComponent<C>>;
}

/**
 * NgModule re-export of the standalone pair for apps still organized around
 * NgModules:
 *
 *   @NgModule({ imports: [AtollIslandModule] })
 *   export class AppModule {}
 *
 * Standalone imports (`imports: [AtollIslandComponent]`) remain the primary
 * interface — the module exists purely for NgModule-era codebases, matching
 * `AtollModule` in @atolljs/angular.
 */
@NgModule({
  imports: [AtollIslandComponent, AtollIslandDirective],
  exports: [AtollIslandComponent, AtollIslandDirective],
})
export class AtollIslandModule {}
