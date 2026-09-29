/**
 * Two entry points, two topologies:
 *
 *   // render.worker.ts — a REGISTRY worker: one script, many apps
 *   import { definePolyWorker } from '@jwhenry123/mesh-islands/worker';
 *   export const renderWorker = definePolyWorker({
 *     apps: { controls: ControlsApp, table: TableApp },
 *   });
 *
 *   // charts.worker.ts — a MONO worker: one script, one app (1:1)
 *   export const chartsWorker = defineMonoWorker(ChartsApp);
 *
 * `definePolyWorker` serves a registry — every island's worker runs the
 * same script and `mount(instance, props)` picks a component out of `apps`.
 * `defineMonoWorker` serves exactly one app: the shell mounts it without
 * naming a registry key (or with any name — a single-registered-app worker
 * resolves its sole app regardless), and the worker's bundle carries only
 * that app's dependencies.
 *
 * APP REGISTRY is module-level: in a real worker each entry file loads its
 * own module graph (a instance worker sees exactly its app); under the
 * in-process test harness several worker entries share one graph, so
 * registration is a UNION and mounts still resolve — same semantics both
 * worlds.
 *
 * INSTANCE KEYS are `app` or `app@instance` — the part before the last '@'
 * names the registry app (or 'main' for unnamed instance-worker mounts), the
 * rest distinguishes instances so the same app can mount more than once —
 * INCLUDING into one shared worker when two islands share a client
 * (multi-island-per-worker: one worker, two mounts, two reconcilers).
 * MountIsland mints a fresh key per island. Wire signatures carry the instance key (`updateProps(instance,
 * props)`, `flush(instance)`, `whoami(instance)`) so a call routes to its instance —
 * the main-thread mountIsland helper binds it, so shell code just calls
 * `island.updateProps(props)`.
 *
 * IMPERATIVE INSTANCES: a registry entry can be `{ imperative: (doc, props) }`
 * instead of a component. Those mounts hold no reconciler at all: mount
 * hands the app a instance-scoped proxy DOM and its mutations emit ops
 * directly (updateProps = clear + rebuild, dispatch = runInInstance + drain,
 * flush = drain only). See worker/proxyDom.ts.
 *
 * RENDERED INSTANCES: `{ mount: (ctx) => handle | void }` is the same shape
 * for non-React framework renderers — mount(ctx) renders into the instance's
 * proxy document and returns a handle whose `update(props)` takes over
 * updateProps (fine-grained patching instead of rebuild) and whose
 * `dispose()` runs before the document dies.
 *
 * Ops still ride back through the pool's ordinary postMessage channel — the
 * sharedMemory contract here is only the doorbell (see memory.ts): a commit
 * counter the main thread observe()s to trigger flush() as a push. Drop it
 * entirely and the islands still work on the 50ms poll — that's the
 * message-only mode.
 */

import type { ReactElement } from 'react';
import type { ReactInstance } from './reactInstance';
import { defineWorker } from '@jwhenry123/mesh/sdk';
import type { SharedMemory, WorkerDefinition } from '@jwhenry123/mesh/sdk';
import { islandAppNameOf } from '../app';
import { renderMemory, type DoorbellSpec } from '../memory';
import { CALLBACK_EVENT, unmarshalCallbackProps } from '../callbackProps';
import {
  createProxyDocument,
  installInstanceDispatcher,
  docForInstance,
  type InternalDocument,
  type ProxyDocument,
} from './proxyDom';
import {
  bumpOpsVersion,
  getHandler,
  instances,
  pushOp,
  runInInstance,
  setActiveInstance,
  setDoorbellContract,
  setInstanceSize,
  takeOps,
} from './instance';
import type { EventPayload, IslandWorkerMethods, Op } from '../ops';

/**
 * Registry value shapes:
 *  - a React component function — reconciled into the instance's own root.
 *    (`props: any` so plain `function App({ x }: Props)` components register
 *    without casts — props are serialized across the wire anyway.)
 *  - `{ imperative: (doc, props) => void }` — NO React at all. mount() hands
 *    it a proxy DOM scoped to the instance; its mutations emit ops directly.
 */
export type ReactIslandApp = (props: any) => ReactElement;
export interface ImperativeIslandApp {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>) => void;
  /**
   * Optional teardown — runs inside the instance's scope BEFORE its proxy
   * document is disposed (unmount, remount, updateProps rebuild). Cancel
   * library timers/animation loops/listeners here (e.g. `map.remove()`) so
   * deferred work can't mutate a dead instance or a foreign ambient document
   * after teardown.
   */
  dispose?: (doc: ProxyDocument) => void;
}

/**
 * What a non-React framework renderer receives at mount: the instance's wire
 * key (scopes emit() and instance-less ops), a fresh proxy document whose
 * mutations emit ops, and the serialized props the shell mounted with.
 */
export interface RenderContext {
  instance: string;
  doc: ProxyDocument;
  props: Record<string, unknown>;
}
export interface RenderedHandle {
  /**
   * Fine-grained prop update — the renderer patches its live tree. When
   * omitted, updateProps falls back to imperative semantics: dispose +
   * clear + re-mount on a fresh document.
   */
  update?(props: Record<string, unknown>): void;
  /**
   * App teardown — runs inside the instance's scope BEFORE its proxy document
   * is disposed (unmount, remount, updateProps rebuild). Same rules as
   * ImperativeIslandApp.dispose: cancel framework roots/effects here.
   */
  dispose?(): void;
}
/**
 * A renderer-backed app: a non-React framework renderer (Vue, Svelte,
 * Solid, Angular) whose `mount` renders component output into the instance's
 * proxy document — every proxy mutation already serializes to ops. Package
 * adapters (e.g. @jwhenry123/mesh-vue-island/worker) wrap a component into
 * this shape so it can sit beside React and imperative apps in the same
 * `apps` registry.
 */
export interface RenderedIslandApp {
  mount(ctx: RenderContext): RenderedHandle | void;
}
/** The apps an island can mount — keyed by the name the shell passes to mount(). */
export type IslandApp = ReactIslandApp | ImperativeIslandApp | RenderedIslandApp;

export interface PolyWorkerRegistry {
  /** Name → island app registry. The shell's `mountIsland({ app: name })`
   *  picks one per island. */
  apps: Record<string, IslandApp>;
  /**
   * The doorbell contract the worker exposes — defaults to the package's
   * `renderMemory`. Rarely needed: pass a different doorbell-SPEC instance
   * if your worker module already defines one (the main side always uses
   * `makeDoorbell()`, so the spec must match: `opsVersion` number field).
   */
  sharedMemory?: SharedMemory<DoorbellSpec>;
}

const isImperative = (app: IslandApp | undefined): app is ImperativeIslandApp =>
  typeof app === 'object' && app !== null && 'imperative' in app;

const isRendered = (app: IslandApp | undefined): app is RenderedIslandApp =>
  typeof app === 'object' && app !== null && 'mount' in app;

/**
 * Wrap a `{__cb:id}` wire handle into the callable the app receives: pushing
 * a reserved `emit` op onto THIS instance's queue (the driver's emit-case
 * dispatches it to the marshalled shell function) and ringing the doorbell
 * so out-of-task invocations — timers, continuations — still flush.
 * Fire-and-forget: there is no channel for a shell return value.
 */
const callbackFactory =
  (instance: string) =>
  (id: number) =>
  (...args: unknown[]): void => {
    pushOp(instance, { t: 'emit', name: CALLBACK_EVENT, payload: { id, args } });
    bumpOpsVersion();
  };

interface InstanceBase {
  /** The wire key — 'app' or 'app@instance'; op queues route by this. */
  key: string;
  /** The registry name — which component this instance renders. */
  app: string;
  /** Per-instance random id — shown in the island's badge as proof it's a
   *  distinct render instance (in production: a distinct worker). Stable across
   *  remounts of the same instance key. */
  pid: string;
}

interface ImperativeInstance extends InstanceBase {
  rendered?: undefined;
  imperative: {
    build: ImperativeIslandApp['imperative'];
    /** Optional app teardown — run before the instance's doc is disposed. */
    dispose: ImperativeIslandApp['dispose'];
    /** The instance's proxy document — replaced on each rebuild. */
    doc: ProxyDocument;
    props: Record<string, unknown>;
  };
}

interface RenderedInstance extends InstanceBase {
  imperative?: undefined;
  rendered: {
    app: RenderedIslandApp;
    /** The mount-returned handle — drives fine-grained updates/teardown. */
    handle: RenderedHandle | void;
    /** The instance's proxy document — replaced on each rebuild. */
    doc: ProxyDocument;
    props: Record<string, unknown>;
  };
}

/** A mounted instance — one per island worker in production. */
export type Instance = ReactInstance | ImperativeInstance | RenderedInstance;

const isImperativeInstance = (r: Instance): r is ImperativeInstance => r.imperative !== undefined;
const isRenderedInstance = (r: Instance): r is RenderedInstance => r.rendered !== undefined;

/** instance key → mounted instance. Production workers hold one entry per island
 *  mounted into them — more than one only when islands share a client. */
const mounts = new Map<string, Instance>();

/**
 * Module-level app registry — one module graph = one registry (see the
 * header note). definePolyWorker registers its whole `apps` map;
 * defineMonoWorker registers its single app.
 */
const APP_REGISTRY = new Map<string, IslandApp>();

const registerSingleApp = (name: string, app: IslandApp): void => {
  APP_REGISTRY.set(name, app);
};

/**
 * Resolve a mount's registry name → app. A single-entry registry is
 * name-blind: a instance worker mounts its one app whatever instance key arrives
 * ('main@1' from an un-named <Island/>, 'charts@2' from a stamped one), so
 * `app` is genuinely optional on the shell side for 1:1 workers.
 */
const resolveApp = (name: string): IslandApp | undefined =>
  APP_REGISTRY.get(name) ??
  (APP_REGISTRY.size === 1 ? APP_REGISTRY.values().next().value : undefined);

const newPid = (): string => `w-${Math.random().toString(36).slice(2, 8)}`;

/**
 * react/react-reconciler arrive here — dynamically, so a worker bundle whose
 * registry holds only Vue/Svelte/Solid/Angular/imperative apps never pays
 * for the reconciler. Cached after the first React mount.
 */
let reactRuntime: Promise<typeof import('./reactInstance')> | undefined;
const loadReactRuntime = (): Promise<typeof import('./reactInstance')> =>
  (reactRuntime ??= import('./reactInstance'));

/** 'controls' or 'data-table@7' → 'data-table' — registry name part of a instance key. */
const appNameOf = (instance: string): string => {
  const at = instance.lastIndexOf('@');
  return at === -1 ? instance : instance.slice(0, at);
};

/**
 * The worker-side half of an island — registers mount / updateProps /
 * dispatch / flush / whoami on the worker's task surface and wires the
 * doorbell contract. Shared by both entry points; they differ only in what
 * they register.
 */
function createIslandRuntime(
  sharedMemory: SharedMemory<DoorbellSpec> = renderMemory,
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  // Point bumpOpsVersion at the declared contract (it's the same object as
  // renderMemory unless a custom doorbell instance was passed).
  setDoorbellContract(sharedMemory);
  // Give every instance DOM globals — `document`/`window`/`Element` resolve to
  // the active instance's proxy document. Libraries a React app pulls in
  // (recharts, d3-ish helpers) can then read them without the app ever
  // installing a shim; imperative apps get the same globals via
  // installDomShim, which builds on this.
  installInstanceDispatcher();

  // Legacy root (tag 0) — no concurrent features. Container creation is
  // per-instance, not module-level, so a second mount() can't collide with the
  // first instance's tree. Imperative mounts skip the reconciler entirely —
  // their "host environment" is the proxy DOM, and build() emits ops itself.
  function createInstance(key: string, pid: string): Instance {
    const app = resolveApp(appNameOf(key));
    if (isRendered(app)) {
      return {
        key,
        app: appNameOf(key),
        pid,
        rendered: { app, handle: undefined, doc: createProxyDocument(key), props: {} },
      };
    }
    if (isImperative(app)) {
      return {
        key,
        app: appNameOf(key),
        pid,
        imperative: {
          build: app.imperative,
          dispose: app.dispose,
          doc: createProxyDocument(key),
          props: {},
        },
      };
    }
    throw new Error(
      `createInstance: "${appNameOf(key)}" resolved to a React app — React mounts are created by reactInstance (lazy import), this path is unreachable`,
    );
  }

  /**
   * Commit synchronously around `fn` and return the ops it produced, scoped
   * to `instance`'s queue.
   *
   * In 0.34, `updateContainer`/setState only *schedule* work — the actual
   * render+commit happens when the root scheduler task runs (a macrotask via
   * the `scheduler` package). `flushSyncFromReconciler` pins the update
   * priority to the discrete/sync lane for the duration of `fn` and flushes
   * pending sync work in its `finally`, so by the time it returns the
   * mutation hooks have run and the instance's op queue is full.
   */
  function syncCommit(instance: ReactInstance, fn: () => void): Op[] {
    const prev = setActiveInstance(instance.key);
    try {
      instance.reconciler.flushSyncFromReconciler(fn);
      instance.reconciler.flushSyncWork();
      return takeOps(instance.key);
    } finally {
      setActiveInstance(prev);
    }
  }

  /**
   * Rebuild an imperative instance — the simplest honest updateProps/remount
   * semantics for code with no reconciler: dispose the old document (its
   * handler ids die with it — and the global DOM shim it installed is
   * unwound), emit `clear` so the driver empties the island root, then
   * re-run build() on a FRESH proxy document whose shadow tree starts
   * empty like the real one. All inside the instance's active scope so emit()
   * and instance-less ops route correctly.
   */
  function rebuildImperative(instance: ImperativeInstance, props: Record<string, unknown>): Op[] {
    return runInInstance(instance.key, () => {
      const imp = instance.imperative;
      imp.dispose?.(imp.doc);
      imp.doc.dispose();
      pushOp(instance.key, { t: 'clear' });
      imp.doc = createProxyDocument(instance.key);
      imp.props = props;
      imp.build(imp.doc, props);
      return takeOps(instance.key);
    });
  }

  /**
   * Rebuild a rendered instance — dispose the framework's mount handle, drop
   * the proxy document, `clear`, then re-mount on a fresh document. Used
   * for remounts and for updateProps when the handle exposes no `update`.
   */
  function rebuildRendered(instance: RenderedInstance, props: Record<string, unknown>): Op[] {
    return runInInstance(instance.key, () => {
      const r = instance.rendered;
      r.handle?.dispose?.();
      r.doc.dispose();
      pushOp(instance.key, { t: 'clear' });
      r.doc = createProxyDocument(instance.key);
      r.props = props;
      r.handle = r.app.mount({ instance: instance.key, doc: r.doc, props });
      return takeOps(instance.key);
    });
  }

  return defineWorker({
    sharedMemory,
    methods: {
      /**
       * Mount apps[appNameOf(instance)] into its own root; returns the
       * initial op batch. The instance key may carry an instance suffix
       * ('data-table@3') so the same app can mount multiple times.
       *
       * Mounting a instance key that is already mounted is a REMOUNT: the old
       * tree is unmounted first (a `clear` op + GC of its instance records),
       * then a fresh container renders the new tree — the returned batch
       * replays cleanly onto an emptied root. The pid is kept across remounts.
       */
      async mount(instance: string, props: Record<string, unknown> = {}): Promise<Op[]> {
        // {__cb:id} handles become callables scoped to THIS instance — invoking
        // one emits a callback-prop op the driver routes to the shell's
        // marshalled function (fire-and-forget, doorbell-rung for out-of-
        // task callers like timers/promise continuations).
        props = unmarshalCallbackProps(props, callbackFactory(instance)) as Record<string, unknown>;
        const App = resolveApp(appNameOf(instance));
        if (App === undefined) {
          throw new Error(
            `mount: unknown app "${instance}" — registry has: ${[...APP_REGISTRY.keys()].join(', ')}`,
          );
        }

        let mounted = mounts.get(instance);
        // Imperative/rendered remount — same clear+rebuild semantics as
        // updateProps; the instance (and pid) survives.
        if (mounted !== undefined && isImperativeInstance(mounted)) {
          return rebuildImperative(mounted, props);
        }
        if (mounted !== undefined && isRenderedInstance(mounted)) {
          return rebuildRendered(mounted, props);
        }

        let ops: Op[] = [];
        if (!isRendered(App) && !isImperative(App)) {
          // React app — the reconciler arrives via a lazy import so
          // non-React worker bundles never pay for it.
          const rt = await loadReactRuntime();
          let reactInstance: ReactInstance;
          if (mounted !== undefined) {
            // Remount — unmount the existing tree so React detaches its
            // instances, then rebuild on a fresh container. The pid is kept.
            const old = mounted as ReactInstance;
            ops = syncCommit(old, () => old.unmountTree());
            reactInstance = rt.createReactInstance(instance, appNameOf(instance), old.pid);
          } else {
            reactInstance = rt.createReactInstance(instance, appNameOf(instance), newPid());
          }
          mounts.set(instance, reactInstance);
          return ops.concat(
            syncCommit(reactInstance, () => reactInstance.render(App, props)),
          );
        }

        // Imperative/rendered first mount. (A mounted React instance being
        // replaced by a non-React app unmounts through syncCommit first.)
        if (mounted !== undefined) {
          const old = mounted as ReactInstance;
          ops = syncCommit(old, () => old.unmountTree());
          mounted = createInstance(instance, old.pid);
        } else {
          mounted = createInstance(instance, newPid());
        }
        mounts.set(instance, mounted);

        if (isImperativeInstance(mounted)) {
          // First mount of an imperative instance — run build() in the instance's
          // scope and drain the ops its proxy-DOM mutations emitted.
          const imp = mounted.imperative;
          imp.props = props;
          return ops.concat(
            runInInstance(instance, () => {
              imp.build(imp.doc, props);
              return takeOps(instance);
            }),
          );
        }

        // First mount of a rendered instance — mount() in the instance's scope;
        // the framework's proxy-DOM mutations emit the initial op batch.
        const r = (mounted as RenderedInstance).rendered;
        r.props = props;
        return ops.concat(
          runInInstance(instance, () => {
            r.handle = r.app.mount({ instance, doc: r.doc, props });
            return takeOps(instance);
          }),
        );
      },

      /**
       * Re-render the instance's root with new props — the shell→island channel.
       * `updateProps` is how the shell mediates between islands (controls
       * emits filterChanged → shell → table.updateProps({filter})).
       */
      updateProps(instance: string, props: Record<string, unknown>): Op[] {
        props = unmarshalCallbackProps(props, callbackFactory(instance)) as Record<string, unknown>;
        const mounted = mounts.get(instance);
        if (mounted === undefined) {
          throw new Error(`updateProps: "${instance}" is not mounted in this worker — mount() first`);
        }
        // Imperative mounts have no diffing — updateProps REBUILDS: clear the
        // root and re-run build(props) on a fresh proxy document. Documented
        // as the honest semantics; fine for widgets, not for huge trees.
        if (isImperativeInstance(mounted)) return rebuildImperative(mounted, props);
        // Rendered mounts prefer their own fine-grained update; absent a
        // handle.update they fall back to the same rebuild.
        if (isRenderedInstance(mounted)) {
          const r = mounted.rendered;
          if (r.handle?.update === undefined) return rebuildRendered(mounted, props);
          return runInInstance(instance, () => {
            r.handle!.update!(props);
            r.props = props;
            return takeOps(instance);
          });
        }
        const App = resolveApp(mounted.app) as (props: Record<string, unknown>) => ReactElement;
        return syncCommit(mounted, () => mounted.render(App, props));
      },

      /**
       * Run the prop function the main thread identified by handlerId —
       * `__evt` refs are handles into the worker's handler table. The entry
       * records which instance registered it, so the re-render's ops land on the
       * right island's queue.
       */
      dispatch(handlerId: number, payload: EventPayload): Op[] {
        const entry = getHandler(handlerId);
        if (entry === undefined) return [];
        const instance = mounts.get(entry.instance);
        if (instance === undefined) return []; // stale handler — its tree was remounted
        // Give handlers real event-object semantics: `target` is the proxy
        // node for the wire's targetId (when it maps to an op-created node),
        // `currentTarget` the element this handler was attached to. Libraries
        // that read geometry off them (recharts' getRelativeCoordinate) get
        // the proxy's honest zeros instead of crashing on undefined.
        const p = payload as EventPayload & { target?: unknown; currentTarget?: unknown };
        if (p.target === undefined || p.currentTarget === undefined) {
          const doc = docForInstance(instance.key);
          if (p.target === undefined && typeof p.targetId === 'number') {
            const t = instances.get(p.targetId);
            if (t !== undefined) p.target = doc.adopt(t);
          }
          if (p.currentTarget === undefined && entry.instanceId !== undefined) {
            // id 0 = the island container — its facade is the doc's root.
            p.currentTarget =
              entry.instanceId === 0
                ? doc._root
                : (instances.get(entry.instanceId) !== undefined
                    ? doc.adopt(instances.get(entry.instanceId)!)
                    : undefined);
          }
        }
        if (isImperativeInstance(instance) || isRenderedInstance(instance)) {
          // No reconciler to flush — the handler's proxy-DOM mutations emit
          // ops directly; runInInstance gives emit() and instance-less ops a
          // queue to route to.
          return runInInstance(instance.key, () => {
            entry.fn(payload);
            return takeOps(instance.key);
          });
        }
        return syncCommit(instance, () => {
          entry.fn(payload);
        });
      },

      /**
       * The pushed-size channel: the driver measured the island's container
       * and stores it for the instance (see hostConfig instanceSizes). Imperative
       * mounts additionally fire their proxy document's onResize handlers —
       * inside the instance's scope so their mutations emit ops, which ride
       * back in this task's return batch. React mounts have no proxy doc;
       * the stored size is still what a shim-installed document would read.
       */
      setSize(instance: string, width: number, height: number): Op[] {
        setInstanceSize(instance, width, height);
        const mounted = mounts.get(instance);
        if (
          mounted !== undefined &&
          (isImperativeInstance(mounted) || isRenderedInstance(mounted))
        ) {
          return runInInstance(mounted.key, () => {
            const doc = isImperativeInstance(mounted)
              ? mounted.imperative.doc
              : mounted.rendered.doc;
            (doc as InternalDocument)._notifySize(width, height);
            return takeOps(instance);
          });
        }
        return takeOps(instance);
      },

      /**
       * Tear down ONE instance while the worker keeps serving its others —
       * the multi-island-per-worker counterpart to process death: unmounts
       * the React tree (or disposes the imperative instance's proxy document),
       * drops the instance entry, and returns the detach op batch. Stale
       * handler dispatches then no-op via the mounts.get() guard.
       */
      unmount(instance: string): Op[] {
        const mounted = mounts.get(instance);
        if (mounted === undefined) return [];
        mounts.delete(instance);
        if (isImperativeInstance(mounted)) {
          // The app's dispose hook cancels deferred work (library timers,
          // animation loops) BEFORE the doc dies — disposing the doc then
          // unwinds its DOM shim and drops its handlers.
          runInInstance(instance, () => {
            const imp = mounted.imperative;
            imp.dispose?.(imp.doc);
            imp.doc.dispose();
          });
          return [{ t: 'clear' }];
        }
        if (isRenderedInstance(mounted)) {
          runInInstance(instance, () => {
            const r = mounted.rendered;
            r.handle?.dispose?.();
            r.doc.dispose();
          });
          return [{ t: 'clear' }];
        }
        return syncCommit(mounted, () => mounted.unmountTree());
      },

      /**
       * Drain one instance's ops committed outside a sync task — passive effects
       * (useEffect), timers, async setState. The pool protocol has no push
       * channel, so the main thread polls this (or the doorbell pushes it).
       */
      flush(instance: string): Op[] {
        const mounted = mounts.get(instance);
        if (mounted === undefined) return [];
        // Imperative and rendered mounts have no passive effects — ops
        // committed outside a task (timers, continuations mutating the proxy
        // DOM) just drain.
        if (isImperativeInstance(mounted) || isRenderedInstance(mounted)) return takeOps(instance);
        const prev = setActiveInstance(instance);
        try {
          mounted.flush();
          return takeOps(instance);
        } finally {
          setActiveInstance(prev);
        }
      },

      /** The mounted instance's random id — the island's "worker pid" badge. */
      whoami(instance: string): string {
        return mounts.get(instance)?.pid ?? 'unmounted';
      },
    },
  });
}

/**
 * PolyWorker — one worker script serving a REGISTRY of islands:
 * `mountIsland({ app: name })` picks one per island, and every island in
 * the registry shares the worker's module graph, framework runtimes, and
 * op pump. This is the bundle-optimization host shape — several islands,
 * one worker to load and keep warm.
 */
export function definePolyWorker(
  registry: PolyWorkerRegistry,
  options?: { sharedMemory?: SharedMemory<DoorbellSpec> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  for (const [key, app] of Object.entries(registry.apps)) {
    const stamped = islandAppNameOf(app);
    if (stamped !== undefined && stamped !== key) {
      console.warn(
        `[definePolyWorker] app registered as "${key}" but stamped "${stamped}" — ` +
          `component-reference mounts resolve "${stamped}" and will fail. Fix the key or the stamp.`,
      );
    }
    registerSingleApp(key, app);
  }
  return createIslandRuntime(registry.sharedMemory ?? options?.sharedMemory);
}

/**
 * MonoWorker — one worker script pinned to ONE island app (1:1). The
 * isolation host shape: own bundle, own failure domain, nothing reachable
 * outside the single app it serves. `mountIsland` can omit `app` — the
 * worker resolves its sole app regardless of the supplied name.
 */
export function defineMonoWorker(
  app: IslandApp,
  options?: { sharedMemory?: SharedMemory<DoorbellSpec> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  const stamp = (app as { islandAppName?: unknown }).islandAppName;
  registerSingleApp(typeof stamp === 'string' && stamp !== '' ? stamp : 'main', app);
  return createIslandRuntime(options?.sharedMemory);
}
