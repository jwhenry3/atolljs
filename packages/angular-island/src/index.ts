/**
 * `@atolljs/angular-island` — the Angular shell surface for
 * `@atolljs/islands` islands: a worker-hosted React (or
 * imperative proxy-DOM) tree mounted as an ordinary element in a
 * main-thread Angular app.
 *
 * ```ts
 * import { Component } from '@angular/core';
 * import { connectIslandWorker } from '@atolljs/islands';
 * import { AtollIslandComponent } from '@atolljs/angular-island';
 *
 * const chartsWorker = () =>
 *   new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
 *
 * @Component({
 *   standalone: true,
 *   imports: [AtollIslandComponent],
 *   template: `<atoll-island
 *     [client]="client"
 *     app="charts"
 *     [props]="props"
 *     [onEvent]="onIslandEvent" />`,
 * })
 * export class DashboardComponent {
 *   readonly client = connectIslandWorker({ worker: chartsWorker });
 *   props = { width: 520 };
 *   onIslandEvent = (name: string, payload: unknown) => { ... };
 * }
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
 * - `app`/`client` changes remount the island (destroy + fresh mount);
 *   `ngOnDestroy` destroys the island — the worker terminates unless the
 *   client is SHARED (several islands on one client mount mounts into one
 *   worker; the instance unmounts and the worker dies with the last island
 *   to leave).
 *
 * `AtollIslandDirective` (`[atollIsland]`) carries the same inputs and can be
 * applied to ANY host element (`<div atollIsland [client]="…"/>`);
 * `AtollIslandComponent` (`<atoll-island>`) is the same behavior with the
 * dedicated element selector — both inherit from a shared base so their
 * input surface and lifecycle are identical.
 */
import {
  Component,
  Directive,
  ElementRef,
  Input,
  NgModule,
  inject,
} from '@angular/core';
import type {
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { mountIsland } from '@atolljs/islands';
import type { IslandClient, IslandHandle } from '@atolljs/islands';

// Re-export the handle types consumers need to name — same courtesy as the
// React binding, so a second package import is never required.
export type { IslandClient, IslandHandle };

/**
 * Shared island-mounting behavior for `<atoll-island>` and `[atollIsland]`.
 *
 * Declared as a bare `@Directive()` (no selector) so Angular treats it as a
 * directive base class: its `@Input()` members and lifecycle hooks are
 * inherited by both subclasses, which supply only a selector.
 */
@Directive()
export abstract class AtollIslandBase implements OnInit, OnChanges, OnDestroy {
  /**
   * How to reach the worker — a pre-connected `IslandClient` from
   * `connectIslandWorker({ worker })`. Required. (Unlike the React binding,
   * this surface takes only a client: in Angular the worker factory is
   * naturally shared/provided at connection time, so the client — which can
   * also be SHARED across several islands in one worker — is the honest
   * contract.)
   */
  @Input() client!: IslandClient;
  /**
   * Registry app name — a key of the `apps` map passed to
   * `definePolyWorker`. Optional against a instance worker
   * (`defineMonoWorker`), which resolves its single app regardless.
   */
  @Input() app?: string;
  /** Initial + updated root props — serialized to the worker. */
  @Input() props?: Record<string, unknown>;
  /**
   * Transclusion slots — a worker `<div data-atoll-slot="name">` hands its
   * real element to `slots[name](el)` so the shell can mount main-thread
   * content inside it. Called again with `null` on teardown.
   */
  @Input() slots?: Record<string, (el: HTMLElement | null) => void>;
  /** Island → shell channel: every `emit` op lands here. */
  @Input() onEvent?: (name: string, payload: unknown) => void;
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
    if ('app' in changes || 'client' in changes) {
      // A different app or worker connection is a different island.
      this.island?.destroy();
      this.island = null;
      this.mount();
      return;
    }
    if ('props' in changes) this.pushProps();
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
    if (client === undefined || client === null) {
      this.report(
        new Error('[atollIsland] requires a `client` input — see connectIslandWorker'),
      );
      return;
    }
    const propsJson = JSON.stringify(this.props ?? {});
    void (async () => {
      try {
        const handle = await mountIsland({
          client,
          el,
          app: this.app,
          props: this.props ?? {},
          onEvent: (name, payload) => this.onEvent?.(name, payload),
          onActivity: () => this.onActivity?.(),
          slots: this.slotDelegate,
        });
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
    this.island?.updateProps(this.props ?? {}).catch((err) => {
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
 */
@Component({
  selector: 'atoll-island',
  standalone: true,
  // No template — the island owns the host element's contents; Angular
  // projects nothing into it.
  template: '',
})
export class AtollIslandComponent extends AtollIslandBase {}

/**
 * `<div atollIsland [client]="…" [props]="…"/>` — the same island lifecycle as
 * an attribute directive, for hosts that need their own tag/attributes.
 */
@Directive({
  selector: '[atollIsland]',
  standalone: true,
})
export class AtollIslandDirective extends AtollIslandBase {}

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
