/**
 * Worker entry — owns the reconcilers and exposes the island task methods.
 *
 * APP REGISTRY: every island's worker runs THIS same script. `mount(realm,
 * props)` picks a component out of REGISTRY and reconciles it into that
 * realm's own root: its own reconciler, container, op queue, and pid.
 * In production each worker mounts exactly one realm — one client,
 * poolSize 1, one tree. Multiple realms in one module only happen in the
 * in-process test, where every island shares the module graph.
 *
 * REALM KEYS are `app` or `app@instance` — the part before the last '@'
 * names the registry app, the rest distinguishes instances so the same
 * microfrontend can mount more than once (mountIsland mints a fresh key
 * per island). Wire signatures carry the realm key (`updateProps(realm,
 * props)`, `flush(realm)`, `whoami(realm)`) so a call routes to its realm —
 * the main-thread mountIsland helper binds it, so shell code just calls
 * `island.updateProps(props)`.
 *
 * IMPERATIVE REALMS: a registry entry can be `{ imperative: (doc, props) }`
 * instead of a component — 'vanilla' is one. Those realms hold no
 * reconciler at all: mount hands the app a realm-scoped proxy DOM and its
 * mutations emit ops directly (updateProps = clear + rebuild, dispatch =
 * runInRealm + drain, flush = drain only). See worker/proxyDom.ts.
 *
 * Ops still ride back through the pool's ordinary postMessage channel — the
 * sharedMemory contract here is only the doorbell (see memory.ts): a commit
 * counter the main thread observe()s to trigger flush() as a push. Drop it
 * entirely and the example still works on the 50ms poll — that's the
 * message-only mode.
 */

import { createElement, type ReactElement } from 'react';
import Reconciler from 'react-reconciler';
import { defineWorker } from '@jwhenry123/mesh/sdk';
import { renderMemory } from '../memory';
import { ControlsApp, StatsApp, TableApp } from './apps';
import { buildVanilla } from './vanilla';
import { createProxyDocument, type ProxyDocument } from './proxyDom';
import {
  getHandler,
  hostConfig,
  pushOp,
  ROOT_CONTAINER,
  runInRealm,
  setActiveRealm,
  takeOps,
} from './hostConfig';
import type { EventPayload, Op } from '../ops';

/**
 * Registry value shapes:
 *  - a React component function — reconciled into the realm's own root
 *  - `{ imperative: (doc, props) => void }` — NO React at all. mount() hands
 *    it a proxy DOM scoped to the realm; its mutations emit ops directly.
 */
type ReactApp = (props: Record<string, unknown>) => ReactElement;
interface ImperativeApp {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>) => void;
}
type RegistryApp = ReactApp | ImperativeApp;

/** The apps an island can mount — keyed by the name the shell passes to mount(). */
const REGISTRY: Record<string, RegistryApp> = {
  controls: ControlsApp as ReactApp,
  'data-table': TableApp as ReactApp,
  stats: StatsApp as ReactApp,
  vanilla: { imperative: buildVanilla },
};

const isImperative = (app: RegistryApp | undefined): app is ImperativeApp =>
  typeof app === 'object' && app !== null && 'imperative' in app;

interface RealmBase {
  /** The wire key — 'app' or 'app@instance'; op queues route by this. */
  key: string;
  /** The registry name — which component this realm renders. */
  app: string;
  /** Per-realm random id — shown in the island's badge as proof it's a
   *  distinct render realm (in production: a distinct worker). Stable across
   *  remounts of the same realm key. */
  pid: string;
}

interface ReactRealm extends RealmBase {
  imperative?: undefined;
  reconciler: ReturnType<typeof Reconciler>;
  container: unknown;
}

interface ImperativeRealm extends RealmBase {
  imperative: {
    build: ImperativeApp['imperative'];
    /** The realm's proxy document — replaced on each rebuild. */
    doc: ProxyDocument;
    props: Record<string, unknown>;
  };
}

type Realm = ReactRealm | ImperativeRealm;

const isImperativeRealm = (r: Realm): r is ImperativeRealm => r.imperative !== undefined;

/** realm key → mounted realm. Production workers hold exactly one entry. */
const realms = new Map<string, Realm>();

const newPid = (): string => `w-${Math.random().toString(36).slice(2, 8)}`;

/** 'controls' or 'data-table@7' → 'data-table' — registry name part of a realm key. */
const appNameOf = (realm: string): string => {
  const at = realm.lastIndexOf('@');
  return at === -1 ? realm : realm.slice(0, at);
};

// Legacy root (tag 0) — no concurrent features. Container creation is
// per-realm, not module-level, so a second mount() can't collide with the
// first realm's tree. Imperative realms skip the reconciler entirely —
// their "host environment" is the proxy DOM, and build() emits ops itself.
function createRealm(key: string, pid: string): Realm {
  const app = REGISTRY[appNameOf(key)];
  if (isImperative(app)) {
    return {
      key,
      app: appNameOf(key),
      pid,
      imperative: { build: app.imperative, doc: createProxyDocument(key), props: {} },
    };
  }
  const reconciler = Reconciler(hostConfig);
  const container = reconciler.createContainer(
    ROOT_CONTAINER,
    0,
    null,
    false,
    null,
    '',
    console.error, // onUncaughtError
    console.error, // onCaughtError
    console.error, // onRecoverableError
    null, // onDefaultTransitionIndicator
  );
  return { key, app: appNameOf(key), pid, reconciler, container };
}

/**
 * Commit synchronously around `fn` and return the ops it produced, scoped
 * to `realm`'s queue.
 *
 * In 0.34, `updateContainer`/setState only *schedule* work — the actual
 * render+commit happens when the root scheduler task runs (a macrotask via
 * the `scheduler` package). `flushSyncFromReconciler` pins the update
 * priority to the discrete/sync lane for the duration of `fn` and flushes
 * pending sync work in its `finally`, so by the time it returns the
 * mutation hooks have run and the realm's op queue is full.
 */
function syncCommit(realm: ReactRealm, fn: () => void): Op[] {
  const prev = setActiveRealm(realm.key);
  try {
    realm.reconciler.flushSyncFromReconciler(fn);
    realm.reconciler.flushSyncWork();
    return takeOps(realm.key);
  } finally {
    setActiveRealm(prev);
  }
}

/**
 * Rebuild an imperative realm — the simplest honest updateProps/remount
 * semantics for code with no reconciler: dispose the old document (its
 * handler ids die with it), emit `clear` so the driver empties the island
 * root, then re-run build() on a FRESH proxy document whose shadow tree
 * starts empty like the real one. All inside the realm's active scope so
 * emit() and instance-less ops route correctly.
 */
function rebuildImperative(realm: ImperativeRealm, props: Record<string, unknown>): Op[] {
  return runInRealm(realm.key, () => {
    const imp = realm.imperative;
    imp.doc.dispose();
    pushOp(realm.key, { t: 'clear' });
    imp.doc = createProxyDocument(realm.key);
    imp.props = props;
    imp.build(imp.doc, props);
    return takeOps(realm.key);
  });
}

export const renderWorker = defineWorker({
  sharedMemory: renderMemory,
  methods: {
    /**
     * Mount REGISTRY[appNameOf(realm)] into its own root; returns the
     * initial op batch. The realm key may carry an instance suffix
     * ('data-table@3') so the same app can mount multiple times.
     *
     * Mounting a realm key that is already mounted is a REMOUNT: the old
     * tree is unmounted first (a `clear` op + GC of its instance records),
     * then a fresh container renders the new tree — the returned batch
     * replays cleanly onto an emptied root. The pid is kept across remounts.
     */
    mount(realm: string, props: Record<string, unknown> = {}): Op[] {
      const App = REGISTRY[appNameOf(realm)];
      if (App === undefined) {
        throw new Error(
          `mount: unknown app "${realm}" — registry has: ${Object.keys(REGISTRY).join(', ')}`,
        );
      }

      let mounted = realms.get(realm);
      // Imperative remount — same clear+rebuild semantics as updateProps;
      // the realm (and pid) survives.
      if (mounted !== undefined && isImperativeRealm(mounted)) {
        return rebuildImperative(mounted, props);
      }

      let ops: Op[] = [];
      if (mounted !== undefined) {
        // Remount — unmount the existing tree so React detaches its
        // instances, then rebuild on a fresh container.
        const old = mounted;
        ops = syncCommit(old, () => {
          old.reconciler.updateContainer(null, old.container, null, null);
        });
        mounted = createRealm(realm, old.pid);
      } else {
        mounted = createRealm(realm, newPid());
      }
      realms.set(realm, mounted);

      if (isImperativeRealm(mounted)) {
        // First mount of an imperative realm — run build() in the realm's
        // scope and drain the ops its proxy-DOM mutations emitted.
        const imp = mounted.imperative;
        imp.props = props;
        return ops.concat(
          runInRealm(realm, () => {
            imp.build(imp.doc, props);
            return takeOps(realm);
          }),
        );
      }

      const reactRealm = mounted as ReactRealm;
      return ops.concat(
        syncCommit(reactRealm, () => {
          reactRealm.reconciler.updateContainer(
            createElement(App as ReactApp, props),
            reactRealm.container,
            null,
            null,
          );
        }),
      );
    },

    /**
     * Re-render the realm's root with new props — the shell→island channel.
     * `updateProps` is how the shell mediates between islands (controls
     * emits filterChanged → shell → table.updateProps({filter})).
     */
    updateProps(realm: string, props: Record<string, unknown>): Op[] {
      const mounted = realms.get(realm);
      if (mounted === undefined) {
        throw new Error(`updateProps: "${realm}" is not mounted in this worker — mount() first`);
      }
      // Imperative realms have no diffing — updateProps REBUILDS: clear the
      // root and re-run build(props) on a fresh proxy document. Documented
      // as the honest semantics; fine for widgets, not for huge trees.
      if (isImperativeRealm(mounted)) return rebuildImperative(mounted, props);
      const App = REGISTRY[mounted.app] as ReactApp;
      return syncCommit(mounted, () => {
        mounted.reconciler.updateContainer(createElement(App, props), mounted.container, null, null);
      });
    },

    /**
     * Run the prop function the main thread identified by handlerId —
     * `__evt` refs are handles into the worker's handler table. The entry
     * records which realm registered it, so the re-render's ops land on the
     * right island's queue.
     */
    dispatch(handlerId: number, payload: EventPayload): Op[] {
      const entry = getHandler(handlerId);
      if (entry === undefined) return [];
      const realm = realms.get(entry.realm);
      if (realm === undefined) return []; // stale handler — its tree was remounted
      if (isImperativeRealm(realm)) {
        // No reconciler to flush — the handler's proxy-DOM mutations emit
        // ops directly; runInRealm gives emit() and instance-less ops a
        // queue to route to.
        return runInRealm(realm.key, () => {
          entry.fn(payload);
          return takeOps(realm.key);
        });
      }
      return syncCommit(realm, () => {
        entry.fn(payload);
      });
    },

    /**
     * Drain one realm's ops committed outside a sync task — passive effects
     * (useEffect), timers, async setState. The pool protocol has no push
     * channel, so the main thread polls this (or the doorbell pushes it).
     */
    flush(realm: string): Op[] {
      const mounted = realms.get(realm);
      if (mounted === undefined) return [];
      // Imperative realms have no passive effects — ops committed outside a
      // task (timers, continuations mutating the proxy DOM) just drain.
      if (isImperativeRealm(mounted)) return takeOps(realm);
      const prev = setActiveRealm(realm);
      try {
        mounted.reconciler.flushPassiveEffects();
        mounted.reconciler.flushSyncWork();
        return takeOps(realm);
      } finally {
        setActiveRealm(prev);
      }
    },

    /** The mounted realm's random id — the island's "worker pid" badge. */
    whoami(realm: string): string {
      return realms.get(realm)?.pid ?? 'unmounted';
    },
  },
});

export type RenderWorker = typeof renderWorker;
